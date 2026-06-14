# CollabJam Studio

CollabJam Studio is a Git-native collaborative music studio. Codex agents compose rhythm, harmony, and bass in isolated worktrees; humans review real pull requests before the merged production reaches playback.

## Current capabilities

This foundation includes:

- React + Vite studio shell
- Express API with structured errors, security headers, CORS, and request logging
- SQLite persistence using Node.js 24's built-in `node:sqlite`
- Shared Zod schemas and TypeScript contracts
- Signed, HTTP-only admin session cookie
- Unit and API integration tests
- Git-ready song and music-part JSON files
- Song creation and public production APIs
- Tone.js playback with rhythm, harmony, and bass mute controls
- Isolated Git worktrees for rhythm, harmony, and bass branches
- Parallel agent job orchestration with persisted event history
- Mock agent runner for demos and tests, plus a Codex CLI runner option
- GitHub PR creation for each agent branch
- Human-controlled PR review and merge actions
- Live studio pipeline, commit timeline, review status, and final mix readiness
- Docker deployment for Railway or Render with persistent SQLite, songs, worktrees, and runtime Git repo

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

The web app runs at `http://localhost:5173`; Vite proxies `/api` to the server at `http://localhost:3001`.

For real GitHub PRs, configure:

```bash
GITHUB_TOKEN=github_pat_or_token
GITHUB_OWNER=your-org-or-user
GITHUB_REPO=your-repo
GITHUB_REMOTE=origin
```

The token needs permission to create and merge pull requests. Branches are pushed to `GITHUB_REMOTE` before PR creation.

## Deployment

This project deploys as one full-stack Docker service. The Docker image builds the React app, compiles the Express API, installs `git`, and seeds a persistent runtime Git repository under `/data/repo`. The Dockerfile does not declare a Docker `VOLUME`; configure `/data` using your host's volume or disk settings.

### Render

Render works well for this project as a Docker Web Service, as long as you add a persistent disk mounted at `/data`. Without the disk, the app can boot, but SQLite data, song JSON, and Git worktrees will reset when the service restarts or redeploys.

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from the repo, or create a Docker Web Service manually.
3. Use the root `Dockerfile`.
4. Add a persistent disk:

```bash
Mount path: /data
Size: 1 GB or larger
```

5. Set these required environment variables:

```bash
NODE_ENV=production
DATABASE_PATH=/data/collabjam.db
GIT_REPO_PATH=/data/repo
SONGS_PATH=/data/repo/songs
WORKTREES_PATH=/data/worktrees
WEB_ORIGIN=https://your-render-service.onrender.com
ADMIN_PASSWORD=choose-a-long-password
SESSION_SECRET=generate-at-least-32-random-characters
AGENT_RUNNER=mock
```

Render provides `PORT`; do not hard-code it unless you are running the container yourself.

6. Set the health check path to `/api/health`.

For Blueprint deploys, `render.yaml` includes the Docker service, `/data` disk, health check, and non-secret defaults. Fill in the `sync: false` values in the Render dashboard after the service is created.

### Railway

Railway also works with the same Docker image and `/data` layout.

1. Push this repository to GitHub.
2. Create a Railway project from the GitHub repository.
3. Add a Railway volume mounted at `/data`.
4. Set the required environment variables:

```bash
NODE_ENV=production
PORT=3001
DATABASE_PATH=/data/collabjam.db
GIT_REPO_PATH=/data/repo
SONGS_PATH=/data/repo/songs
WORKTREES_PATH=/data/worktrees
WEB_ORIGIN=https://your-railway-domain.up.railway.app
ADMIN_PASSWORD=choose-a-long-password
SESSION_SECRET=generate-at-least-32-random-characters
AGENT_RUNNER=mock
```

5. Deploy. Railway uses `railway.json` and the root `Dockerfile`; health checks target `/api/health`.

For real GitHub PRs on Render or Railway, also set:

```bash
GITHUB_TOKEN=github_pat_or_token
GITHUB_OWNER=your-org-or-user
GITHUB_REPO=your-demo-repo
GITHUB_REMOTE=origin
GIT_AUTHOR_NAME=CollabJam Studio
GIT_AUTHOR_EMAIL=collabjam@example.local
```

The startup script configures the runtime repo's `origin` remote and provides the token to `git push` through `GIT_ASKPASS`, so the token is not written into the Git remote URL.

For hosted Codex agents, switch:

```bash
AGENT_RUNNER=codex
CODEX_COMMAND=codex
CODEX_TIMEOUT_MS=300000
OPENAI_API_KEY=your-openai-api-key
```

The Docker image installs the Codex CLI by default. Keep `AGENT_RUNNER=mock` for a predictable public demo that does not consume Codex credits.

## Commands

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

For a production-style local run, build first and set `NODE_ENV=production`. The Express server serves `apps/web/dist` and provides SPA fallback routing.

## Architecture

```text
apps/web         React studio interface
apps/server      Express API, authentication, and SQLite
packages/shared  Runtime schemas and shared TypeScript types
```

## Roadmap

1. Foundation: monorepo, app shell, API, authentication, and persistence
2. Music domain: JSON music schema and Tone.js sequencing
3. Git engine: isolated worktrees and agent branches
4. Codex agents: parallel structured generation
5. GitHub workflow: real pull requests and human-controlled merges
6. Studio UI: live history, reviews, and final production
7. Deployment: Docker deployment with persistent storage for Railway and Render

Phases 1-7 are implemented. The default runner is `AGENT_RUNNER=mock` so local demos and tests do not consume Codex credits; set `AGENT_RUNNER=codex` to use the configured `CODEX_COMMAND`.
