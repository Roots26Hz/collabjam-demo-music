import { z } from "zod";

const optionalEnvironmentValue = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_PATH: z.string().min(1).default("./data/collabjam.db"),
  GIT_REPO_PATH: z.string().min(1).default("."),
  SONGS_PATH: z.string().min(1).default("./songs"),
  WORKTREES_PATH: z.string().min(1).default("./worktrees"),
  AGENT_RUNNER: z.enum(["mock", "codex"]).default("mock"),
  CODEX_COMMAND: z.string().min(1).default("codex"),
  CODEX_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  GITHUB_TOKEN: optionalEnvironmentValue,
  GITHUB_OWNER: optionalEnvironmentValue,
  GITHUB_REPO: optionalEnvironmentValue,
  GITHUB_REMOTE: z.string().min(1).default("origin"),
  ADMIN_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(32)
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv): AppConfig {
  return environmentSchema.parse(environment);
}
