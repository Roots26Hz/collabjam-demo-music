import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvironment } from "dotenv";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import { createDatabase, recoverInterruptedJobs } from "./database.js";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
loadEnvironment({ path: resolve(projectRoot, ".env") });

function projectPath(path: string) {
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}

const parsedConfig = parseConfig(process.env);
const config = {
  ...parsedConfig,
  DATABASE_PATH: projectPath(parsedConfig.DATABASE_PATH),
  GIT_REPO_PATH: projectPath(parsedConfig.GIT_REPO_PATH),
  SONGS_PATH: projectPath(parsedConfig.SONGS_PATH),
  WORKTREES_PATH: projectPath(parsedConfig.WORKTREES_PATH)
};
const database = createDatabase(config.DATABASE_PATH);
recoverInterruptedJobs(database);
const app = createApp(config, database);

const server = app.listen(config.PORT, () => {
  console.log(`CollabJam server listening on http://localhost:${config.PORT}`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
