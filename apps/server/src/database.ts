import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      style_prompt TEXT NOT NULL,
      bpm INTEGER NOT NULL,
      musical_key TEXT NOT NULL,
      time_signature TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS music_parts (
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      file_path TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (song_id, role)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      role TEXT,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commits (
      sha TEXT PRIMARY KEY,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      role TEXT,
      branch TEXT NOT NULL,
      message TEXT NOT NULL,
      committed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS git_branches (
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (song_id, role)
    );

    CREATE TABLE IF NOT EXISTS pull_requests (
      number INTEGER PRIMARY KEY,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      head_branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      merged_at TEXT
    );
  `);

  const jobColumns = database
    .prepare("PRAGMA table_info(jobs)")
    .all() as Array<{ name: string }>;
  if (!jobColumns.some((column) => column.name === "error")) {
    database.exec("ALTER TABLE jobs ADD COLUMN error TEXT;");
  }

  return database;
}

export function recoverInterruptedJobs(database: DatabaseSync) {
  const now = new Date().toISOString();
  const message = "Agent job was interrupted before the server restarted.";
  database
    .prepare(
      "UPDATE agent_runs SET status = 'failed', error = ?, completed_at = ? WHERE status IN ('queued', 'running', 'validating')"
    )
    .run(message, now);
  database
    .prepare(
      "UPDATE jobs SET status = 'failed', error = ?, completed_at = ? WHERE status IN ('queued', 'running')"
    )
    .run(message, now);
}
