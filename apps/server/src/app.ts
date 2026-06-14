import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { createAgentOrchestrator } from "./agents.js";
import type { AppConfig } from "./config.js";
import { errorHandler, notFound } from "./errors.js";
import { createGitEngine } from "./git.js";
import { createGitHubWorkflow } from "./github.js";
import { createSessionHandlers } from "./session.js";
import { createSongStore } from "./songs.js";

export function createApp(config: AppConfig, database: DatabaseSync) {
  const app = express();
  app.set("env", config.NODE_ENV);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(pinoHttp());
  app.use(
    helmet({
      contentSecurityPolicy:
        config.NODE_ENV === "production" ? undefined : false
    })
  );
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "64kb" }));

  const sessions = createSessionHandlers(
    config.ADMIN_PASSWORD,
    config.SESSION_SECRET
  );
  const git = createGitEngine(
    database,
    config.GIT_REPO_PATH,
    config.WORKTREES_PATH
  );
  const songs = createSongStore(database, config.SONGS_PATH, git);
  const agents = createAgentOrchestrator(database, git, {
    runner: config.AGENT_RUNNER,
    codexCommand: config.CODEX_COMMAND,
    codexTimeoutMs: config.CODEX_TIMEOUT_MS
  });
  const pullRequests = createGitHubWorkflow(database, git, config);

  app.get("/api/health", (_request, response) => {
    database.prepare("SELECT 1").get();
    response.json({
      status: "ok",
      database: "ok",
      timestamp: new Date().toISOString()
    });
  });
  app.get("/api/session", sessions.getSession);
  app.post("/api/session/login", sessions.login);
  app.post("/api/session/logout", sessions.logout);
  app.post("/api/admin/check", sessions.requireAdmin, (_request, response) => {
    response.status(204).end();
  });
  app.get("/api/songs", (_request, response) => {
    response.json({ songs: songs.listSongs() });
  });
  app.get("/api/songs/:slug", (request, response) => {
    response.json(songs.getSong(request.params.slug));
  });
  app.get("/api/songs/:slug/history", (request, response) => {
    response.json(songs.getHistory(request.params.slug));
  });
  app.get("/api/songs/:slug/pull-requests", (request, response) => {
    response.json(pullRequests.listForSong(request.params.slug));
  });
  app.post("/api/songs", sessions.requireAdmin, (request, response) => {
    response.status(201).json(songs.createSong(request.body));
  });
  app.post(
    "/api/songs/:slug/generate",
    sessions.requireAdmin,
    (request, response) => {
      response.status(202).json(agents.start(String(request.params.slug)));
    }
  );
  app.post(
    "/api/songs/:slug/pull-requests",
    sessions.requireAdmin,
    async (request, response, next) => {
      try {
        response
          .status(201)
          .json(await pullRequests.createForSong(String(request.params.slug)));
      } catch (error) {
        next(error);
      }
    }
  );
  app.post(
    "/api/pull-requests/:number/review",
    sessions.requireAdmin,
    (request, response) => {
      response.json(pullRequests.markInReview(Number(request.params.number)));
    }
  );
  app.post(
    "/api/pull-requests/:number/merge",
    sessions.requireAdmin,
    async (request, response, next) => {
      try {
        response.json(await pullRequests.merge(Number(request.params.number)));
      } catch (error) {
        next(error);
      }
    }
  );
  app.get("/api/jobs/:jobId", (request, response) => {
    response.json(agents.getSummary(String(request.params.jobId)));
  });
  app.get("/api/jobs/:jobId/events", (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    const send = (event: unknown) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const jobId = String(request.params.jobId);
    for (const event of agents.listEvents(jobId)) send(event);
    const unsubscribe = agents.subscribe(jobId, send);
    request.on("close", unsubscribe);
  });

  app.use("/api", notFound);

  const webDist = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../web/dist"
  );
  if (config.NODE_ENV === "production" && existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("/{*path}", (_request, response) =>
      response.sendFile(resolve(webDist, "index.html"))
    );
  } else {
    app.use(notFound);
  }

  app.use(errorHandler);
  return app;
}
