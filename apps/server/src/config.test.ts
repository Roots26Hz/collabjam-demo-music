import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

describe("environment configuration", () => {
  it("rejects short secrets", () => {
    expect(() =>
      parseConfig({ ADMIN_PASSWORD: "short", SESSION_SECRET: "also-short" })
    ).toThrow();
  });

  it("applies development defaults", () => {
    const config = parseConfig({
      ADMIN_PASSWORD: "long-enough",
      SESSION_SECRET: "a-secret-that-is-at-least-32-characters"
    });
    expect(config.PORT).toBe(3001);
    expect(config.NODE_ENV).toBe("development");
    expect(config.GIT_REPO_PATH).toBe(".");
    expect(config.SONGS_PATH).toBe("./songs");
    expect(config.WORKTREES_PATH).toBe("./worktrees");
    expect(config.AGENT_RUNNER).toBe("mock");
    expect(config.CODEX_COMMAND).toBe("codex");
    expect(config.CODEX_TIMEOUT_MS).toBe(300000);
    expect(config.GITHUB_REMOTE).toBe("origin");
  });
});
