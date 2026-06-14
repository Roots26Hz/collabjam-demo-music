import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import {
  agentEventSchema,
  agentJobSummarySchema,
  agentRoleSchema,
  agentRunSchema,
  musicPartSchema,
  songSchema,
  type AgentEvent,
  type AgentJobSummary,
  type AgentRole,
  type JobStatus,
  type MusicPart,
  type Song
} from "@collabjam/shared";
import { HttpError } from "./errors.js";
import type { createGitEngine } from "./git.js";

type GitEngine = ReturnType<typeof createGitEngine>;
type RunnerMode = "mock" | "codex";
type EventListener = (event: AgentEvent) => void;

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

type JobRow = {
  id: string;
  song_id: string;
  status: JobStatus;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

type RunRow = {
  id: string;
  job_id: string;
  role: AgentRole;
  status: JobStatus;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
};

const roles = agentRoleSchema.options;

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

function rowToSummary(job: JobRow, runs: RunRow[]): AgentJobSummary {
  return agentJobSummarySchema.parse({
    job: {
      id: job.id,
      songId: job.song_id,
      status: job.status,
      error: job.error,
      createdAt: job.created_at,
      completedAt: job.completed_at
    },
    runs: runs.map((run) =>
      agentRunSchema.parse({
        id: run.id,
        jobId: run.job_id,
        role: run.role,
        status: run.status,
        error: run.error,
        startedAt: run.started_at,
        completedAt: run.completed_at
      })
    )
  });
}

function eventMessage(role: AgentRole, status: JobStatus) {
  const label = `${role[0]!.toUpperCase()}${role.slice(1)}`;
  if (status === "running") return `${label} agent is writing its part.`;
  if (status === "validating") return `${label} part is being validated.`;
  if (status === "committed") return `${label} part committed to its branch.`;
  if (status === "failed") return `${label} agent failed.`;
  return `${label} agent queued.`;
}

function writeMockPart(base: MusicPart, role: AgentRole, targetPath: string) {
  const offset = role === "rhythm" ? 0.04 : role === "harmony" ? 0.08 : 0.12;
  const next = musicPartSchema.parse({
    ...base,
    events: base.events.map((event, index) => ({
      ...event,
      velocity: Math.min(
        1,
        Number((event.velocity + offset + (index % 2) * 0.03).toFixed(2))
      )
    }))
  });
  writeFileSync(targetPath, `${JSON.stringify(next, null, 2)}\n`);
}

async function runCodex(
  command: string,
  role: AgentRole,
  song: Song,
  worktreePath: string,
  relativePartPath: string,
  timeoutMs: number
) {
  const prompt = [
    `You are the ${role} music agent for CollabJam Studio.`,
    `Song: ${song.title}. Style: ${song.stylePrompt}.`,
    `Modify only ${relativePartPath}.`,
    "Keep the JSON schema unchanged: version, role, instrument, bars, events.",
    "Return after saving the file."
  ].join("\n");

  const outputPath = join(
    tmpdir(),
    `collabjam-codex-${song.slug}-${role}-${randomUUID()}.txt`
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      command,
      [
        "exec",
        "--cd",
        worktreePath,
        "--sandbox",
        "workspace-write",
        "--ephemeral",
        "--output-last-message",
        outputPath,
        prompt
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let settled = false;
    let closed = false;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, 2_000);
      reject(new Error(`Codex ${role} agent timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      closed = true;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lastMessage = existsSync(outputPath)
        ? readFileSync(outputPath, "utf8").trim()
        : "";
      if (code === 0) resolve();
      else
        reject(
          new Error(
            [
              lastMessage,
              stderr.trim(),
              stdout.trim(),
              `Codex exited with ${code}`
            ]
              .filter(Boolean)
              .join("\n")
          )
        );
    });
  });
}

export function createAgentOrchestrator(
  database: DatabaseSync,
  git: GitEngine,
  options: { runner: RunnerMode; codexCommand: string; codexTimeoutMs: number }
) {
  const events = new EventEmitter();

  function getSong(slug: string): Song {
    const row = database
      .prepare("SELECT * FROM songs WHERE slug = ?")
      .get(slug) as SongRow | undefined;
    if (!row) throw new HttpError(404, "SONG_NOT_FOUND", "Song not found.");
    return rowToSong(row);
  }

  function getSummary(jobId: string): AgentJobSummary {
    const job = database
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(jobId) as JobRow | undefined;
    if (!job) throw new HttpError(404, "JOB_NOT_FOUND", "Job not found.");
    const runs = database
      .prepare("SELECT * FROM agent_runs WHERE job_id = ? ORDER BY role")
      .all(jobId) as RunRow[];
    return rowToSummary(job, runs);
  }

  function addEvent(
    jobId: string,
    role: AgentRole | null,
    status: JobStatus,
    message: string
  ) {
    const createdAt = new Date().toISOString();
    const result = database
      .prepare(
        "INSERT INTO agent_events (job_id, role, status, message, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(jobId, role, status, message, createdAt);
    const event = agentEventSchema.parse({
      id: Number(result.lastInsertRowid),
      jobId,
      role,
      status,
      message,
      createdAt
    });
    events.emit(jobId, event);
    return event;
  }

  function updateRun(
    runId: string,
    status: JobStatus,
    error: string | null = null
  ) {
    const now = new Date().toISOString();
    const started = status === "running" ? ", started_at = ?" : "";
    const completed = ["committed", "failed"].includes(status)
      ? ", completed_at = ?"
      : "";
    const values: (string | null)[] = [status, error];
    if (started) values.push(now);
    if (completed) values.push(now);
    values.push(runId);
    database
      .prepare(
        `UPDATE agent_runs SET status = ?, error = ?${started}${completed} WHERE id = ?`
      )
      .run(...values);
  }

  function updateJob(
    jobId: string,
    status: JobStatus,
    error: string | null = null
  ) {
    const completedAt = ["completed", "failed"].includes(status)
      ? new Date().toISOString()
      : null;
    database
      .prepare(
        "UPDATE jobs SET status = ?, error = ?, completed_at = ? WHERE id = ?"
      )
      .run(status, error, completedAt, jobId);
  }

  async function runRole(
    jobId: string,
    runId: string,
    song: Song,
    role: AgentRole
  ) {
    try {
      const relativePartPath = join(
        "songs",
        song.slug,
        "parts",
        `${role}.json`
      );
      const branch = git.getBranch(song.id, role);
      const targetPath = join(branch.worktreePath, relativePartPath);
      const basePart = musicPartSchema.parse(
        JSON.parse(readFileSync(targetPath, "utf8"))
      );

      updateRun(runId, "running");
      addEvent(jobId, role, "running", eventMessage(role, "running"));
      if (options.runner === "mock") writeMockPart(basePart, role, targetPath);
      else
        await runCodex(
          options.codexCommand,
          role,
          song,
          branch.worktreePath,
          relativePartPath,
          options.codexTimeoutMs
        );

      updateRun(runId, "validating");
      addEvent(jobId, role, "validating", eventMessage(role, "validating"));
      const generated = musicPartSchema.parse(
        JSON.parse(readFileSync(targetPath, "utf8"))
      );
      if (generated.role !== role) {
        throw new Error(`Expected ${role} part, received ${generated.role}`);
      }

      const message = `${role[0]!.toUpperCase()}${role.slice(1)} agent: generate initial pattern v1`;
      const commit = git.commitAgentPart(song, role, relativePartPath, message);
      if (!commit)
        throw new Error(`${role} agent did not change ${relativePartPath}`);
      updateRun(runId, "committed");
      addEvent(jobId, role, "committed", eventMessage(role, "committed"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${role} agent failed.`;
      updateRun(runId, "failed", message);
      addEvent(jobId, role, "failed", message);
      throw error;
    }
  }

  async function runJob(jobId: string, song: Song) {
    updateJob(jobId, "running");
    addEvent(jobId, null, "running", "Parallel agents started.");
    const runs = database
      .prepare("SELECT * FROM agent_runs WHERE job_id = ? ORDER BY role")
      .all(jobId) as RunRow[];
    const results = await Promise.allSettled(
      runs.map((run) => runRole(jobId, run.id, song, run.role))
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failure) {
      const message =
        failure.reason instanceof Error
          ? failure.reason.message
          : "Agent failed.";
      updateJob(jobId, "failed", message);
      addEvent(jobId, null, "failed", message);
      return;
    }
    updateJob(jobId, "completed");
    database
      .prepare("UPDATE songs SET status = ?, updated_at = ? WHERE id = ?")
      .run("review", new Date().toISOString(), song.id);
    addEvent(
      jobId,
      null,
      "completed",
      "All agent branches are ready for review."
    );
  }

  function start(slug: string): AgentJobSummary {
    const song = getSong(slug);
    const jobId = randomUUID();
    const now = new Date().toISOString();
    database
      .prepare(
        "INSERT INTO jobs (id, song_id, status, error, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(jobId, song.id, "queued", null, now, null);
    const insertRun = database.prepare(
      "INSERT INTO agent_runs (id, job_id, role, status, error, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const role of roles) {
      insertRun.run(randomUUID(), jobId, role, "queued", null, null, null);
      addEvent(jobId, role, "queued", eventMessage(role, "queued"));
    }
    void runJob(jobId, song);
    return getSummary(jobId);
  }

  function listEvents(jobId: string): AgentEvent[] {
    const rows = database
      .prepare("SELECT * FROM agent_events WHERE job_id = ? ORDER BY id")
      .all(jobId) as Array<{
      id: number;
      job_id: string;
      role: AgentRole | null;
      status: JobStatus;
      message: string;
      created_at: string;
    }>;
    return rows.map((row) =>
      agentEventSchema.parse({
        id: row.id,
        jobId: row.job_id,
        role: row.role,
        status: row.status,
        message: row.message,
        createdAt: row.created_at
      })
    );
  }

  function subscribe(jobId: string, listener: EventListener) {
    events.on(jobId, listener);
    return () => events.off(jobId, listener);
  }

  return { start, getSummary, listEvents, subscribe };
}
