import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, recoverInterruptedJobs } from "./database.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("database recovery", () => {
  it("marks interrupted jobs and agent runs as failed", () => {
    database = createDatabase(":memory:");
    database
      .prepare(
        "INSERT INTO songs (id, slug, title, style_prompt, bpm, musical_key, time_signature, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        "song-1",
        "funk-test",
        "Funk Test",
        "Funk",
        112,
        "C minor",
        "4/4",
        "draft",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z"
      );
    database
      .prepare(
        "INSERT INTO jobs (id, song_id, status, created_at) VALUES (?, ?, ?, ?)"
      )
      .run("job-1", "song-1", "running", "2026-01-01T00:00:00.000Z");
    database
      .prepare(
        "INSERT INTO agent_runs (id, job_id, role, status, started_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "run-1",
        "job-1",
        "rhythm",
        "validating",
        "2026-01-01T00:00:00.000Z"
      );

    recoverInterruptedJobs(database);

    expect(
      database.prepare("SELECT status FROM jobs WHERE id = ?").get("job-1")
    ).toMatchObject({ status: "failed" });
    expect(
      database
        .prepare("SELECT status FROM agent_runs WHERE id = ?")
        .get("run-1")
    ).toMatchObject({ status: "failed" });
  });
});
