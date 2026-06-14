import type { DatabaseSync } from "node:sqlite";
import {
  agentRoleSchema,
  pullRequestSummarySchema,
  songSchema,
  type AgentRole,
  type PullRequestStatus,
  type PullRequestSummary,
  type Song
} from "@collabjam/shared";
import type { AppConfig } from "./config.js";
import { HttpError } from "./errors.js";
import type { createGitEngine } from "./git.js";

type GitEngine = ReturnType<typeof createGitEngine>;

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

type PullRequestRow = {
  number: number;
  song_id: string;
  role: AgentRole;
  title: string;
  url: string;
  head_branch: string;
  base_branch: string;
  status: PullRequestStatus;
  created_at: string;
  merged_at: string | null;
};

type GitHubPullRequest = {
  number: number;
  html_url: string;
  title: string;
  state: "open" | "closed";
  merged_at?: string | null;
};

type GitHubMergeResponse = {
  merged: boolean;
  sha?: string;
  message?: string;
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

function rowToPullRequest(row: PullRequestRow): PullRequestSummary {
  return pullRequestSummarySchema.parse({
    number: row.number,
    songId: row.song_id,
    role: row.role,
    title: row.title,
    url: row.url,
    headBranch: row.head_branch,
    baseBranch: row.base_branch,
    status: row.status,
    createdAt: row.created_at,
    mergedAt: row.merged_at
  });
}

function roleLabel(role: AgentRole) {
  return `${role[0]!.toUpperCase()}${role.slice(1)}`;
}

function requireGitHubConfig(config: AppConfig) {
  if (!config.GITHUB_TOKEN || !config.GITHUB_OWNER || !config.GITHUB_REPO) {
    throw new HttpError(
      503,
      "GITHUB_NOT_CONFIGURED",
      "GitHub integration requires GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO."
    );
  }
  return {
    token: config.GITHUB_TOKEN,
    owner: config.GITHUB_OWNER,
    repo: config.GITHUB_REPO,
    remote: config.GITHUB_REMOTE
  };
}

async function githubRequest<T>(
  config: ReturnType<typeof requireGitHubConfig>,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}${path}`,
    {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        ...init.headers
      }
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new HttpError(
      response.status >= 500 ? 502 : response.status,
      "GITHUB_REQUEST_FAILED",
      text || "GitHub request failed."
    );
  }
  return (await response.json()) as T;
}

export function createGitHubWorkflow(
  database: DatabaseSync,
  git: GitEngine,
  config: AppConfig
) {
  function getSong(slug: string): Song {
    const row = database
      .prepare("SELECT * FROM songs WHERE slug = ?")
      .get(slug) as SongRow | undefined;
    if (!row) throw new HttpError(404, "SONG_NOT_FOUND", "Song not found.");
    return rowToSong(row);
  }

  function getPullRequest(number: number): PullRequestSummary {
    const row = database
      .prepare("SELECT * FROM pull_requests WHERE number = ?")
      .get(number) as PullRequestRow | undefined;
    if (!row)
      throw new HttpError(404, "PULL_REQUEST_NOT_FOUND", "PR not found.");
    return rowToPullRequest(row);
  }

  function listForSong(slug: string) {
    const song = getSong(slug);
    const rows = database
      .prepare("SELECT * FROM pull_requests WHERE song_id = ? ORDER BY role")
      .all(song.id) as PullRequestRow[];
    return { pullRequests: rows.map(rowToPullRequest) };
  }

  async function createForSong(slug: string) {
    const song = getSong(slug);
    const github = requireGitHubConfig(config);
    const existing = listForSong(slug).pullRequests;
    const createdAt = new Date().toISOString();
    const insert = database.prepare(
      `INSERT OR REPLACE INTO pull_requests
       (number, song_id, role, title, url, head_branch, base_branch, status, created_at, merged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const role of roles) {
      if (existing.some((pullRequest) => pullRequest.role === role)) continue;
      const branch = git.pushBranch(song.id, role, github.remote);
      const title = `${roleLabel(role)} agent for ${song.title}`;
      const pullRequest = await githubRequest<GitHubPullRequest>(
        github,
        "/pulls",
        {
          method: "POST",
          body: JSON.stringify({
            title,
            head: branch.branch,
            base: "main",
            body: `CollabJam ${role} agent output for ${song.title}.`
          })
        }
      );
      insert.run(
        pullRequest.number,
        song.id,
        role,
        pullRequest.title || title,
        pullRequest.html_url,
        branch.branch,
        "main",
        "open",
        createdAt,
        null
      );
    }

    return listForSong(slug);
  }

  function markInReview(number: number) {
    const pullRequest = getPullRequest(number);
    if (pullRequest.status !== "open") return pullRequest;
    database
      .prepare("UPDATE pull_requests SET status = ? WHERE number = ?")
      .run("review", number);
    return getPullRequest(number);
  }

  async function merge(number: number) {
    const pullRequest = getPullRequest(number);
    if (pullRequest.status !== "review") {
      throw new HttpError(
        409,
        "PULL_REQUEST_NOT_IN_REVIEW",
        "Move the PR to review before approving the merge."
      );
    }
    const github = requireGitHubConfig(config);
    const result = await githubRequest<GitHubMergeResponse>(
      github,
      `/pulls/${number}/merge`,
      {
        method: "PUT",
        body: JSON.stringify({
          commit_title: `Merge ${pullRequest.title}`,
          merge_method: "merge"
        })
      }
    );
    if (!result.merged) {
      throw new HttpError(
        409,
        "GITHUB_MERGE_REJECTED",
        result.message ?? "GitHub did not merge the PR."
      );
    }

    const songRow = database
      .prepare("SELECT * FROM songs WHERE id = ?")
      .get(pullRequest.songId) as SongRow | undefined;
    if (!songRow) throw new HttpError(404, "SONG_NOT_FOUND", "Song not found.");
    const song = rowToSong(songRow);
    git.mergeBranchToMain(song, pullRequest.role);

    const mergedAt = new Date().toISOString();
    database
      .prepare(
        "UPDATE pull_requests SET status = ?, merged_at = ? WHERE number = ?"
      )
      .run("merged", mergedAt, number);

    const remaining = database
      .prepare(
        "SELECT COUNT(*) AS count FROM pull_requests WHERE song_id = ? AND status != ?"
      )
      .get(song.id, "merged") as { count: number };
    if (remaining.count === 0) {
      database
        .prepare("UPDATE songs SET status = ?, updated_at = ? WHERE id = ?")
        .run("merged", mergedAt, song.id);
    }

    return getPullRequest(number);
  }

  return { listForSong, createForSong, markInReview, merge };
}
