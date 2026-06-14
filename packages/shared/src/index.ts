import { z } from "zod";

export const agentRoleSchema = z.enum(["rhythm", "harmony", "bass"]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const songStatusSchema = z.enum([
  "draft",
  "generating",
  "review",
  "merged"
]);
export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "validating",
  "committed",
  "failed",
  "completed"
]);
export const pullRequestStatusSchema = z.enum([
  "open",
  "review",
  "merged",
  "closed"
]);

export const songSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(120),
  stylePrompt: z.string().min(1).max(1000),
  bpm: z.number().int().min(40).max(240),
  key: z.string().min(1).max(12),
  timeSignature: z.string().regex(/^\d+\/\d+$/),
  status: songStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});

export const agentJobSchema = z.object({
  id: z.string().uuid(),
  songId: z.string().uuid(),
  status: jobStatusSchema,
  error: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).nullable()
});

export const agentRunSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  role: agentRoleSchema,
  status: jobStatusSchema,
  error: z.string().nullable(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable()
});

export const commitSummarySchema = z.object({
  sha: z.string().min(7),
  songId: z.string().uuid(),
  role: agentRoleSchema.nullable(),
  branch: z.string().min(1),
  message: z.string().min(1),
  committedAt: z.string().datetime({ offset: true })
});

export const pullRequestSummarySchema = z.object({
  number: z.number().int().positive(),
  songId: z.string().uuid(),
  role: agentRoleSchema,
  title: z.string().min(1),
  url: z.string().url(),
  headBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  status: pullRequestStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  mergedAt: z.string().datetime({ offset: true }).nullable()
});

export const sessionSchema = z.object({ authenticated: z.boolean() });

export const createSongSchema = z.object({
  title: z.string().trim().min(1).max(120),
  stylePrompt: z.string().trim().min(1).max(1000),
  bpm: z.number().int().min(40).max(240),
  key: z.string().trim().min(1).max(12),
  timeSignature: z.string().regex(/^\d+\/\d+$/)
});

export const musicPositionSchema = z.string().regex(/^\d+:\d+:\d+$/);
export const musicEventSchema = z.object({
  time: musicPositionSchema,
  note: z.string().min(1).max(12),
  duration: z.string().min(1).max(8),
  velocity: z.number().min(0).max(1)
});

export const musicPartSchema = z.object({
  version: z.literal(1),
  role: agentRoleSchema,
  instrument: z.enum(["drums", "poly-synth", "mono-synth"]),
  bars: z.number().int().min(1).max(64),
  events: z.array(musicEventSchema).max(2048)
});

export const songProductionSchema = z.object({
  song: songSchema,
  parts: z.array(musicPartSchema)
});

export const branchSummarySchema = z.object({
  songId: z.string().uuid(),
  role: agentRoleSchema,
  branch: z.string().min(1),
  worktreePath: z.string().min(1),
  status: z.enum(["ready", "missing"]),
  createdAt: z.string().datetime({ offset: true })
});

export const songHistorySchema = z.object({
  commits: z.array(commitSummarySchema),
  branches: z.array(branchSummarySchema)
});

export const pullRequestListSchema = z.object({
  pullRequests: z.array(pullRequestSummarySchema)
});

export const agentEventSchema = z.object({
  id: z.number().int().nonnegative(),
  jobId: z.string().uuid(),
  role: agentRoleSchema.nullable(),
  status: jobStatusSchema,
  message: z.string(),
  createdAt: z.string().datetime({ offset: true })
});

export const agentJobSummarySchema = z.object({
  job: agentJobSchema,
  runs: z.array(agentRunSchema)
});

export type Song = z.infer<typeof songSchema>;
export type CreateSong = z.infer<typeof createSongSchema>;
export type MusicEvent = z.infer<typeof musicEventSchema>;
export type MusicPart = z.infer<typeof musicPartSchema>;
export type SongProduction = z.infer<typeof songProductionSchema>;
export type BranchSummary = z.infer<typeof branchSummarySchema>;
export type SongHistory = z.infer<typeof songHistorySchema>;
export type SongStatus = z.infer<typeof songStatusSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type AgentJob = z.infer<typeof agentJobSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentJobSummary = z.infer<typeof agentJobSummarySchema>;
export type CommitSummary = z.infer<typeof commitSummarySchema>;
export type PullRequestSummary = z.infer<typeof pullRequestSummarySchema>;
export type PullRequestList = z.infer<typeof pullRequestListSchema>;
export type PullRequestStatus = z.infer<typeof pullRequestStatusSchema>;
export type Session = z.infer<typeof sessionSchema>;
