import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { createDatabase } from "./database.js";

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createTestConfig(): AppConfig {
  const root = mkdtempSync(join(tmpdir(), "collabjam-tests-"));
  const repo = join(root, "repo");
  const remote = join(root, "origin.git");
  execFileSync("git", ["init", "-b", "main", repo]);
  execFileSync("git", ["init", "--bare", remote]);
  git(repo, ["config", "user.name", "CollabJam Tests"]);
  git(repo, ["config", "user.email", "tests@collabjam.local"]);
  writeFileSync(join(repo, "README.md"), "test repo\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "Initial commit"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-u", "origin", "main"]);

  return {
    NODE_ENV: "test",
    PORT: 3001,
    WEB_ORIGIN: "http://localhost:5173",
    DATABASE_PATH: ":memory:",
    GIT_REPO_PATH: repo,
    SONGS_PATH: join(repo, "songs"),
    WORKTREES_PATH: join(root, "worktrees"),
    AGENT_RUNNER: "mock",
    CODEX_COMMAND: "codex",
    CODEX_TIMEOUT_MS: 300000,
    GITHUB_TOKEN: "github-token",
    GITHUB_OWNER: "collabjam",
    GITHUB_REPO: "studio",
    GITHUB_REMOTE: "origin",
    ADMIN_PASSWORD: "correct-horse",
    SESSION_SECRET: "a-test-secret-that-is-at-least-32-characters"
  };
}

type TestAgent = ReturnType<typeof request.agent>;

async function waitForJob(agent: TestAgent, jobId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await agent.get(`/api/jobs/${jobId}`).expect(200);
    if (["completed", "failed"].includes(response.body.job.status)) {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Job ${jobId} did not finish`);
}

describe("server API", () => {
  let database: ReturnType<typeof createDatabase>;
  let app: ReturnType<typeof createApp>;
  let config: AppConfig;

  beforeEach(() => {
    config = createTestConfig();
    database = createDatabase(":memory:");
    app = createApp(config, database);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    database.close();
  });

  it("reports service and database health", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.body).toMatchObject({ status: "ok", database: "ok" });
  });

  it("rejects an invalid password", async () => {
    const response = await request(app)
      .post("/api/session/login")
      .send({ password: "incorrect" })
      .expect(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("logs in, authorizes protected actions, and logs out", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/session/login")
      .send({ password: "correct-horse" })
      .expect(200);
    await agent.post("/api/admin/check").expect(204);
    await agent.post("/api/session/logout").expect(200);
    await agent.post("/api/admin/check").expect(401);
  });

  it("returns the anonymous session state", async () => {
    const response = await request(app).get("/api/session").expect(200);
    expect(response.body).toEqual({ authenticated: false });
  });

  it("requires admin access to create songs", async () => {
    await request(app)
      .post("/api/songs")
      .send({
        title: "Neon Drive",
        stylePrompt: "Retro synth funk",
        bpm: 112,
        key: "A minor",
        timeSignature: "4/4"
      })
      .expect(401);
  });

  it("creates, lists, and returns a playable song", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/session/login")
      .send({ password: "correct-horse" })
      .expect(200);
    const created = await agent
      .post("/api/songs")
      .send({
        title: "Neon Drive",
        stylePrompt: "Retro synth funk",
        bpm: 112,
        key: "A minor",
        timeSignature: "4/4"
      })
      .expect(201);
    expect(created.body.parts).toHaveLength(3);
    expect(created.body.history.commits[0].message).toBe(
      "Create song: Neon Drive"
    );
    expect(created.body.history.branches).toHaveLength(3);

    const list = await request(app).get("/api/songs").expect(200);
    expect(list.body.songs[0].slug).toBe("neon-drive");

    const production = await request(app)
      .get("/api/songs/neon-drive")
      .expect(200);
    expect(production.body.parts[0].events.length).toBeGreaterThan(0);

    const history = await request(app)
      .get("/api/songs/neon-drive/history")
      .expect(200);
    expect(
      history.body.branches.map((branch: { role: string }) => branch.role)
    ).toEqual(["bass", "harmony", "rhythm"]);
    expect(
      git(config.GIT_REPO_PATH, ["branch", "--list", "neon-drive/rhythm"])
    ).toContain("neon-drive/rhythm");
    expect(git(config.GIT_REPO_PATH, ["worktree", "list"])).toContain(
      join(config.WORKTREES_PATH, "neon-drive", "rhythm")
    );
  });

  it("runs three mock agents in parallel and commits each role branch", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/session/login")
      .send({ password: "correct-horse" })
      .expect(200);
    await agent
      .post("/api/songs")
      .send({
        title: "Agent Jam",
        stylePrompt: "Tight parallel funk",
        bpm: 118,
        key: "D minor",
        timeSignature: "4/4"
      })
      .expect(201);

    const unauthorized = await request(app)
      .post("/api/songs/agent-jam/generate")
      .send()
      .expect(401);
    expect(unauthorized.body.error.code).toBe("AUTHENTICATION_REQUIRED");

    const started = await agent
      .post("/api/songs/agent-jam/generate")
      .send()
      .expect(202);
    const summary = await waitForJob(agent, started.body.job.id);
    expect(summary.job.status).toBe("completed");
    expect(summary.runs.map((run: { status: string }) => run.status)).toEqual([
      "committed",
      "committed",
      "committed"
    ]);

    const events = await agent
      .get(`/api/jobs/${started.body.job.id}/events`)
      .buffer(true)
      .parse((response, callback) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
          if (body.includes("All agent branches are ready for review.")) {
            (response as unknown as { destroy: () => void }).destroy();
          }
        });
        response.on("close", () => callback(null, body));
      });
    expect(String(events.body)).toContain("Parallel agents started.");

    const history = await agent.get("/api/songs/agent-jam/history").expect(200);
    const roleCommits = history.body.commits.filter(
      (commit: { role: string | null }) => commit.role
    );
    expect(roleCommits).toHaveLength(3);
    expect(
      roleCommits.map((commit: { message: string }) => commit.message).sort()
    ).toEqual([
      "Bass agent: generate initial pattern v1",
      "Harmony agent: generate initial pattern v1",
      "Rhythm agent: generate initial pattern v1"
    ]);
    expect(
      git(config.GIT_REPO_PATH, ["log", "--oneline", "agent-jam/rhythm", "-1"])
    ).toContain("Rhythm agent: generate initial pattern v1");
  });

  it("creates GitHub PRs and merges only after human review", async () => {
    let nextPullRequestNumber = 40;
    const mergeRequests: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = String(url);
        if (target.endsWith("/pulls") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            title: string;
            head: string;
          };
          const number = nextPullRequestNumber;
          nextPullRequestNumber += 1;
          return Response.json(
            {
              number,
              title: body.title,
              html_url: `https://github.com/collabjam/studio/pull/${number}`,
              state: "open",
              head: { ref: body.head }
            },
            { status: 201 }
          );
        }
        const mergeMatch = target.match(/\/pulls\/(\d+)\/merge$/);
        if (mergeMatch && init?.method === "PUT") {
          mergeRequests.push(Number(mergeMatch[1]));
          return Response.json({ merged: true, sha: "merge-sha" });
        }
        return Response.json({ message: "unexpected" }, { status: 404 });
      })
    );

    const agent = request.agent(app);
    await agent
      .post("/api/session/login")
      .send({ password: "correct-horse" })
      .expect(200);
    await agent
      .post("/api/songs")
      .send({
        title: "Review Jam",
        stylePrompt: "PR-driven funk",
        bpm: 120,
        key: "C minor",
        timeSignature: "4/4"
      })
      .expect(201);
    const started = await agent
      .post("/api/songs/review-jam/generate")
      .send()
      .expect(202);
    await waitForJob(agent, started.body.job.id);

    await request(app)
      .post("/api/songs/review-jam/pull-requests")
      .send()
      .expect(401);

    const created = await agent
      .post("/api/songs/review-jam/pull-requests")
      .send()
      .expect(201);
    expect(created.body.pullRequests).toHaveLength(3);
    expect(
      created.body.pullRequests.map(
        (pullRequest: { status: string }) => pullRequest.status
      )
    ).toEqual(["open", "open", "open"]);
    expect(
      git(config.GIT_REPO_PATH, ["ls-remote", "--heads", "origin"])
    ).toContain("refs/heads/review-jam/rhythm");

    const mergeBeforeReview = await agent
      .post(`/api/pull-requests/${created.body.pullRequests[0].number}/merge`)
      .send()
      .expect(409);
    expect(mergeBeforeReview.body.error.code).toBe(
      "PULL_REQUEST_NOT_IN_REVIEW"
    );

    const review = await agent
      .post(`/api/pull-requests/${created.body.pullRequests[0].number}/review`)
      .send()
      .expect(200);
    expect(review.body.status).toBe("review");

    const merged = await agent
      .post(`/api/pull-requests/${created.body.pullRequests[0].number}/merge`)
      .send()
      .expect(200);
    expect(merged.body.status).toBe("merged");
    expect(mergeRequests).toEqual([created.body.pullRequests[0].number]);
    expect(
      git(config.GIT_REPO_PATH, ["log", "--oneline", "main", "-1"])
    ).toContain("Merge bass agent into final production");

    const finalProduction = await agent
      .get("/api/songs/review-jam")
      .expect(200);
    const bass = finalProduction.body.parts.find(
      (part: { role: string }) => part.role === "bass"
    );
    expect(bass.events[0].velocity).toBeGreaterThan(0.9);
  });

  it("keeps unknown API routes as structured JSON errors", async () => {
    const response = await request(app).get("/api/missing").expect(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("serves the React entry point for production client routes", async () => {
    const productionApp = createApp(
      { ...config, NODE_ENV: "production" },
      database
    );
    const response = await request(productionApp)
      .get("/songs/funk-80s-track")
      .expect(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("<title>CollabJam Studio</title>");
  });
});
