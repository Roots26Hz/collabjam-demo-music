import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  createSongSchema,
  musicPartSchema,
  songProductionSchema,
  songSchema,
  type AgentRole,
  type CreateSong,
  type MusicPart,
  type Song
} from "@collabjam/shared";
import { HttpError } from "./errors.js";
import type { createGitEngine } from "./git.js";

type SongRow = {
  id: string;
  slug: string;
  title: string;
  style_prompt: string;
  bpm: number;
  musical_key: string;
  time_signature: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function rowToSong(row: SongRow): Song {
  return songSchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    stylePrompt: row.style_prompt,
    bpm: row.bpm,
    key: row.musical_key,
    timeSignature: row.time_signature,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return slug || `song-${Date.now()}`;
}

function at(bar: number, beat: number, sixteenth = 0): string {
  return `${bar}:${beat}:${sixteenth}`;
}

function demoParts(): MusicPart[] {
  const rhythm: MusicPart = {
    version: 1,
    role: "rhythm",
    instrument: "drums",
    bars: 4,
    events: []
  };
  const harmony: MusicPart = {
    version: 1,
    role: "harmony",
    instrument: "poly-synth",
    bars: 4,
    events: []
  };
  const bass: MusicPart = {
    version: 1,
    role: "bass",
    instrument: "mono-synth",
    bars: 4,
    events: []
  };
  const chords = [
    ["A3", "C4", "E4"],
    ["F3", "A3", "C4"],
    ["D3", "F3", "A3"],
    ["E3", "G#3", "B3"]
  ];
  const roots = ["A2", "F2", "D2", "E2"];

  for (let bar = 0; bar < 4; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      rhythm.events.push({
        time: at(bar, beat),
        note: beat === 0 || beat === 2 ? "C1" : "D1",
        duration: "16n",
        velocity: beat === 0 ? 1 : 0.72
      });
      rhythm.events.push({
        time: at(bar, beat, 2),
        note: "F#1",
        duration: "32n",
        velocity: 0.36
      });
      bass.events.push({
        time: at(bar, beat),
        note: roots[bar]!,
        duration: beat === 3 ? "8n" : "4n",
        velocity: beat === 0 ? 0.9 : 0.65
      });
    }
    for (const note of chords[bar]!) {
      harmony.events.push({
        time: at(bar, 0),
        note,
        duration: "1m",
        velocity: 0.5
      });
    }
  }
  return [rhythm, harmony, bass].map((part) => musicPartSchema.parse(part));
}

type GitEngine = ReturnType<typeof createGitEngine>;

export function createSongStore(
  database: DatabaseSync,
  songsPath: string,
  git: GitEngine
) {
  mkdirSync(songsPath, { recursive: true });

  function listSongs(): Song[] {
    const rows = database
      .prepare("SELECT * FROM songs ORDER BY created_at DESC")
      .all() as SongRow[];
    return rows.map(rowToSong);
  }

  function getSong(slug: string) {
    const row = database
      .prepare("SELECT * FROM songs WHERE slug = ?")
      .get(slug) as SongRow | undefined;
    if (!row) throw new HttpError(404, "SONG_NOT_FOUND", "Song not found.");
    const song = rowToSong(row);
    const partRows = database
      .prepare("SELECT role, file_path FROM music_parts WHERE song_id = ?")
      .all(song.id) as { role: AgentRole; file_path: string }[];
    const parts = partRows.map(({ file_path }) =>
      musicPartSchema.parse(JSON.parse(readFileSync(file_path, "utf8")))
    );
    return songProductionSchema.parse({ song, parts });
  }

  function createSong(input: CreateSong) {
    const values = createSongSchema.parse(input);
    const baseSlug = slugify(values.title);
    let slug = baseSlug;
    let suffix = 2;
    while (database.prepare("SELECT 1 FROM songs WHERE slug = ?").get(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const now = new Date().toISOString();
    const song = songSchema.parse({
      id: randomUUID(),
      slug,
      ...values,
      status: "draft",
      createdAt: now,
      updatedAt: now
    });
    const parts = demoParts();
    const directory = join(songsPath, slug);
    const partsDirectory = join(directory, "parts");
    mkdirSync(partsDirectory, { recursive: true });
    writeFileSync(
      join(directory, "song.json"),
      `${JSON.stringify(song, null, 2)}\n`
    );
    for (const part of parts) {
      writeFileSync(
        join(partsDirectory, `${part.role}.json`),
        `${JSON.stringify(part, null, 2)}\n`
      );
    }

    database.exec("BEGIN");
    try {
      database
        .prepare(
          `INSERT INTO songs
          (id, slug, title, style_prompt, bpm, musical_key, time_signature, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          song.id,
          song.slug,
          song.title,
          song.stylePrompt,
          song.bpm,
          song.key,
          song.timeSignature,
          song.status,
          song.createdAt,
          song.updatedAt
        );
      const insertPart = database.prepare(
        "INSERT INTO music_parts (song_id, role, file_path, updated_at) VALUES (?, ?, ?, ?)"
      );
      for (const part of parts) {
        insertPart.run(
          song.id,
          part.role,
          join(partsDirectory, `${part.role}.json`),
          now
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    git.commitSongBase(song, directory);
    const branches = git.createWorktrees(song);
    return { song, parts, history: git.getHistory(song.id), branches };
  }

  function getHistory(slug: string) {
    const row = database
      .prepare("SELECT * FROM songs WHERE slug = ?")
      .get(slug) as SongRow | undefined;
    if (!row) throw new HttpError(404, "SONG_NOT_FOUND", "Song not found.");
    return git.getHistory(row.id);
  }

  return { listSongs, getSong, createSong, getHistory };
}
