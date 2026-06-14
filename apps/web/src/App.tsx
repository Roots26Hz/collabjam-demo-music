import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent
} from "react";
import { Link, Route, Routes } from "react-router-dom";
import type {
  AgentRole,
  AgentEvent,
  AgentJobSummary,
  CreateSong,
  PullRequestSummary,
  Session,
  Song,
  SongHistory,
  SongProduction
} from "@collabjam/shared";
import { playProduction } from "./player";

const roleMeta = {
  rhythm: {
    label: "Rhythm",
    color: "var(--coral)",
    bars: [72, 54, 82, 64, 88, 44]
  },
  harmony: {
    label: "Harmony",
    color: "var(--violet)",
    bars: [40, 76, 58, 90, 68, 52]
  },
  bass: { label: "Bass", color: "var(--mint)", bars: [84, 48, 70, 56, 92, 62] }
} satisfies Record<AgentRole, { label: string; color: string; bars: number[] }>;

function formatTime(value: string | null) {
  if (!value) return "pending";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function Studio() {
  const [session, setSession] = useState<Session>({ authenticated: false });
  const [songs, setSongs] = useState<Song[]>([]);
  const [production, setProduction] = useState<SongProduction | null>(null);
  const [history, setHistory] = useState<SongHistory | null>(null);
  const [agentJob, setAgentJob] = useState<AgentJobSummary | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([]);
  const [modal, setModal] = useState<"login" | "song" | null>(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState<Set<AgentRole>>(new Set());
  const player = useRef<Awaited<ReturnType<typeof playProduction>> | null>(
    null
  );

  async function loadSongs() {
    const response = await fetch("/api/songs");
    const data = (await response.json()) as { songs: Song[] };
    setSongs(data.songs);
    if (data.songs[0]) {
      const detail = await fetch(`/api/songs/${data.songs[0].slug}`);
      setProduction((await detail.json()) as SongProduction);
      const historyResponse = await fetch(
        `/api/songs/${data.songs[0].slug}/history`
      );
      setHistory((await historyResponse.json()) as SongHistory);
      await loadPullRequests(data.songs[0].slug);
    }
  }

  async function loadSong(slug: string) {
    const response = await fetch(`/api/songs/${slug}`);
    setProduction((await response.json()) as SongProduction);
    const historyResponse = await fetch(`/api/songs/${slug}/history`);
    setHistory((await historyResponse.json()) as SongHistory);
    await loadPullRequests(slug);
  }

  async function refreshHistory() {
    if (!production) return;
    const historyResponse = await fetch(
      `/api/songs/${production.song.slug}/history`
    );
    setHistory((await historyResponse.json()) as SongHistory);
  }

  async function loadPullRequests(slug: string) {
    const response = await fetch(`/api/songs/${slug}/pull-requests`);
    const data = (await response.json()) as {
      pullRequests: PullRequestSummary[];
    };
    setPullRequests(data.pullRequests);
  }

  useEffect(() => {
    void Promise.all([
      fetch("/api/session", { credentials: "include" })
        .then((response) => response.json())
        .then(setSession),
      loadSongs()
    ]).catch(() => setError("The studio API is unavailable."));
    return () => player.current?.stop();
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    let response: Response;
    try {
      response = await fetch("/api/session/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: form.get("password") })
      });
    } catch {
      setError("The studio API is unavailable.");
      return;
    }
    if (!response.ok) {
      setError(
        response.status === 401
          ? "That password did not unlock the studio."
          : "The studio API is unavailable."
      );
      return;
    }
    setSession({ authenticated: true });
    setModal(null);
  }

  async function createSong(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const input: CreateSong = {
      title: String(form.get("title")),
      stylePrompt: String(form.get("stylePrompt")),
      bpm: Number(form.get("bpm")),
      key: String(form.get("key")),
      timeSignature: "4/4"
    };
    const response = await fetch("/api/songs", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) return setError("Could not create that song.");
    const created = (await response.json()) as SongProduction & {
      history: SongHistory;
    };
    setProduction(created);
    setHistory(created.history);
    setPullRequests([]);
    setSongs((current) => [created.song, ...current]);
    setModal(null);
  }

  async function togglePlayback() {
    if (playing) {
      player.current?.stop();
      player.current = null;
      setPlaying(false);
      return;
    }
    if (!production) return;
    setPlaying(true);
    try {
      player.current = await playProduction(
        production.song,
        production.parts,
        muted,
        () => setPlaying(false)
      );
    } catch {
      setPlaying(false);
      setError("Playback could not start in this browser.");
    }
  }

  function toggleMute(role: AgentRole) {
    setMuted((current) => {
      const next = new Set(current);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      player.current?.setMuted(role, next.has(role));
      return next;
    });
  }

  async function runAgents() {
    if (!production) return;
    setError("");
    const response = await fetch(
      `/api/songs/${production.song.slug}/generate`,
      {
        method: "POST",
        credentials: "include"
      }
    );
    if (!response.ok) {
      setError("Could not start the agent run.");
      return;
    }
    const summary = (await response.json()) as AgentJobSummary;
    setAgentJob(summary);
    setAgentEvents([]);
    const source = new EventSource(`/api/jobs/${summary.job.id}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as AgentEvent;
      setAgentEvents((current) =>
        current.some((item) => item.id === event.id)
          ? current
          : [...current, event]
      );
      if (event.status === "completed" || event.status === "failed") {
        setAgentJob((current) =>
          current
            ? {
                ...current,
                job: {
                  ...current.job,
                  status: event.status,
                  error: event.status === "failed" ? event.message : null,
                  completedAt: event.createdAt
                }
              }
            : current
        );
        source.close();
        void refreshHistory();
        void loadPullRequests(production.song.slug);
      }
    };
    source.onerror = () => source.close();
  }

  async function createPullRequests() {
    if (!production) return;
    setError("");
    const response = await fetch(
      `/api/songs/${production.song.slug}/pull-requests`,
      { method: "POST", credentials: "include" }
    );
    if (!response.ok) {
      setError("Could not create GitHub PRs. Check GitHub configuration.");
      return;
    }
    const data = (await response.json()) as {
      pullRequests: PullRequestSummary[];
    };
    setPullRequests(data.pullRequests);
  }

  async function updatePullRequest(number: number, action: "review" | "merge") {
    setError("");
    const response = await fetch(`/api/pull-requests/${number}/${action}`, {
      method: "POST",
      credentials: "include"
    });
    if (!response.ok) {
      setError(
        action === "merge"
          ? "Could not merge that PR."
          : "Could not move that PR to review."
      );
      return;
    }
    const pullRequest = (await response.json()) as PullRequestSummary;
    setPullRequests((current) =>
      current.map((item) =>
        item.number === pullRequest.number ? pullRequest : item
      )
    );
    if (action === "merge" && production) {
      await loadSong(production.song.slug);
    }
  }

  const song = production?.song;
  const mergedPullRequests = pullRequests.filter(
    (pullRequest) => pullRequest.status === "merged"
  ).length;
  const reviewedPullRequests = pullRequests.filter(
    (pullRequest) =>
      pullRequest.status === "review" || pullRequest.status === "merged"
  ).length;
  const finalMixReady =
    Boolean(production) &&
    pullRequests.length === 3 &&
    mergedPullRequests === pullRequests.length;
  const pipelineSteps = [
    {
      label: "Seed",
      value: history?.commits.length ? "committed" : "waiting",
      active: Boolean(history?.commits.length)
    },
    {
      label: "Agents",
      value: agentJob?.job.status ?? (production ? "ready" : "waiting"),
      active: agentJob?.job.status === "completed"
    },
    {
      label: "Review",
      value:
        pullRequests.length > 0
          ? `${reviewedPullRequests}/${pullRequests.length}`
          : "not opened",
      active: reviewedPullRequests > 0
    },
    {
      label: "Final",
      value: finalMixReady ? "merged" : "pending",
      active: finalMixReady
    }
  ];
  return (
    <div className="app-shell">
      <header>
        <Link className="brand" to="/">
          <span className="brand-mark">CJ</span>
          <span>
            CollabJam <b>Studio</b>
          </span>
        </Link>
        <nav>
          <a href="#agents">Parts</a>
          <a href="#history">Workflow</a>
          <a href="#mix">Player</a>
        </nav>
        <button className="auth-button" onClick={() => setModal("login")}>
          <span
            className={
              session.authenticated ? "status-dot online" : "status-dot"
            }
          />
          {session.authenticated ? "Admin online" : "Admin login"}
        </button>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Git-native music production</p>
            <h1>
              Every part gets its own <em>branch.</em>
            </h1>
            <p className="hero-copy">
              Structured rhythm, harmony, and bass parts are ready for isolated
              Codex worktrees. Compose the seed production now and hear the JSON
              come alive.
            </p>
            <div className="hero-actions">
              <button
                className="primary"
                onClick={() =>
                  session.authenticated ? setModal("song") : setModal("login")
                }
              >
                + Create a song
              </button>
              {songs.length > 1 && (
                <select
                  value={song?.slug}
                  onChange={async (event) => {
                    await loadSong(event.target.value);
                  }}
                >
                  {songs.map((item) => (
                    <option value={item.slug} key={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="record-card">
            <div className={`record ${playing ? "spinning" : ""}`}>
              <div className="label">
                <span>COLLAB</span>
                <strong>JAM</strong>
                <small>STEREO / 33 RPM</small>
              </div>
            </div>
            <div className="now-playing">
              <span>{song ? "Current session" : "No session yet"}</span>
              <strong>{song?.title ?? "Create your first song"}</strong>
              <small>
                {song
                  ? `${song.bpm} BPM · ${song.key} · ${song.timeSignature}`
                  : "JSON + Tone.js"}
              </small>
            </div>
          </div>
        </section>

        <section className="pipeline-strip" aria-label="Studio pipeline">
          {pipelineSteps.map((step) => (
            <div className={step.active ? "active" : ""} key={step.label}>
              <span>{step.label}</span>
              <b>{step.value}</b>
            </div>
          ))}
        </section>

        <section id="agents" className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Structured parts</p>
              <h2>Three voices. One schema.</h2>
            </div>
            <span className="phase-pill">Tone.js ready</span>
          </div>
          <div className="agent-toolbar">
            <button
              className="primary"
              disabled={
                !production ||
                !session.authenticated ||
                ["queued", "running", "validating"].includes(
                  agentJob?.job.status ?? ""
                )
              }
              onClick={() => void runAgents()}
            >
              Run 3 agents
            </button>
            <span>
              {agentJob
                ? `Job ${agentJob.job.status}`
                : "Agents commit to isolated branches."}
            </span>
          </div>
          <div className="agent-grid">
            {(Object.keys(roleMeta) as AgentRole[]).map((role, index) => {
              const meta = roleMeta[role];
              const part = production?.parts.find((item) => item.role === role);
              return (
                <article
                  className={`agent-card ${muted.has(role) ? "muted" : ""}`}
                  key={role}
                  style={{ "--track-color": meta.color } as CSSProperties}
                >
                  <div className="agent-top">
                    <span className="track-number">0{index + 1}</span>
                    <span className="worktree">
                      {part?.instrument ?? "awaiting song"}
                    </span>
                  </div>
                  <h3>{meta.label}</h3>
                  <code>
                    {song
                      ? `songs/${song.slug}/parts/${role}.json`
                      : `${role}.json`}
                  </code>
                  <div className="waveform">
                    {meta.bars.map((height, bar) => (
                      <i key={bar} style={{ height: `${height}%` }} />
                    ))}
                  </div>
                  <div className="agent-footer">
                    <span>
                      <b>
                        {part ? `${part.events.length} events` : "Not created"}
                      </b>
                      <small>
                        {history?.branches.find(
                          (branch) => branch.role === role
                        )?.branch ??
                          (part
                            ? `${part.bars} bars · schema v${part.version}`
                            : "Create a song to seed parts")}
                      </small>
                    </span>
                    <button
                      onClick={() => toggleMute(role)}
                      disabled={!part}
                      aria-label={`${muted.has(role) ? "Unmute" : "Mute"} ${meta.label}`}
                    >
                      {muted.has(role) ? "M" : "♪"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="history" className="workflow">
          <p className="eyebrow">Git history</p>
          <h2>
            {finalMixReady
              ? "Final production is merged."
              : "Worktrees are ready for agents."}
          </h2>
          <div className="steps">
            <div>
              <b>01</b>
              <h3>Main commit</h3>
              <p>
                {history?.commits[0]?.message ??
                  "Create a song to commit its seed files."}
              </p>
            </div>
            <div>
              <b>02</b>
              <h3>Rhythm</h3>
              <p>
                {pullRequests.find(
                  (pullRequest) => pullRequest.role === "rhythm"
                )?.status ??
                  history?.branches.find((branch) => branch.role === "rhythm")
                    ?.status ??
                  "pending"}
              </p>
            </div>
            <div>
              <b>03</b>
              <h3>Harmony</h3>
              <p>
                {pullRequests.find(
                  (pullRequest) => pullRequest.role === "harmony"
                )?.status ??
                  history?.branches.find((branch) => branch.role === "harmony")
                    ?.status ??
                  "pending"}
              </p>
            </div>
            <div>
              <b>04</b>
              <h3>Bass</h3>
              <p>
                {pullRequests.find((pullRequest) => pullRequest.role === "bass")
                  ?.status ??
                  history?.branches.find((branch) => branch.role === "bass")
                    ?.status ??
                  "pending"}
              </p>
            </div>
          </div>
          {history?.commits.length ? (
            <div className="commit-list">
              {history.commits.slice(0, 6).map((commit) => (
                <p key={commit.sha}>
                  <code>{commit.sha.slice(0, 7)}</code>
                  <span>{commit.message}</span>
                  <small>{commit.role ?? "main"}</small>
                </p>
              ))}
            </div>
          ) : null}
          {agentEvents.length > 0 && (
            <div className="event-log">
              {agentEvents.map((event) => (
                <p key={event.id}>
                  <b>{event.role ?? "job"}</b>
                  <span>{event.message}</span>
                </p>
              ))}
            </div>
          )}
          <div className="pr-panel">
            <div>
              <p className="eyebrow">GitHub review</p>
              <h3>Pull requests gate the merge.</h3>
            </div>
            <button
              className="primary"
              disabled={
                !production ||
                !session.authenticated ||
                agentJob?.job.status !== "completed" ||
                pullRequests.length > 0
              }
              onClick={() => void createPullRequests()}
            >
              Create PRs
            </button>
          </div>
          {pullRequests.length > 0 && (
            <div className="pr-grid">
              {pullRequests.map((pullRequest) => (
                <article key={pullRequest.number} className="pr-card">
                  <span>{pullRequest.role}</span>
                  <h3>#{pullRequest.number}</h3>
                  <p>{pullRequest.title}</p>
                  <small>
                    {pullRequest.status === "merged"
                      ? `Merged ${formatTime(pullRequest.mergedAt)}`
                      : `Opened ${formatTime(pullRequest.createdAt)}`}
                  </small>
                  <a href={pullRequest.url} target="_blank" rel="noreferrer">
                    Open on GitHub
                  </a>
                  <div>
                    <b>{pullRequest.status}</b>
                    {pullRequest.status === "open" && (
                      <button
                        disabled={!session.authenticated}
                        onClick={() =>
                          void updatePullRequest(pullRequest.number, "review")
                        }
                      >
                        Start review
                      </button>
                    )}
                    {pullRequest.status === "review" && (
                      <button
                        disabled={!session.authenticated}
                        onClick={() =>
                          void updatePullRequest(pullRequest.number, "merge")
                        }
                      >
                        Approve merge
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section id="mix" className="mix-banner">
          <div>
            <p className="eyebrow">
              {finalMixReady ? "Final merged production" : "Production player"}
            </p>
            <h2>{song?.title ?? "Your final mix starts here."}</h2>
            <p>
              {finalMixReady
                ? "All reviewed agent parts are merged into main and ready for playback."
                : (song?.stylePrompt ??
                  "Create a song to generate a deterministic seed arrangement.")}
            </p>
          </div>
          <button
            className="play-button"
            disabled={!production}
            onClick={() => void togglePlayback()}
          >
            <span>{playing ? "■" : "▶"}</span>
            {playing ? "Stop production" : "Play production"}
          </button>
        </section>
      </main>
      <footer>
        <span>CollabJam Studio · Pune 2026</span>
        <span>React + Tone.js + Git + Codex</span>
      </footer>

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => setModal(null)}>
          {modal === "login" ? (
            <form
              className="login-card"
              onSubmit={login}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="close"
                onClick={() => setModal(null)}
              >
                ×
              </button>
              <p className="eyebrow">Studio access</p>
              <h2>Admin login</h2>
              <p>Unlock song creation and future merge controls.</p>
              <label>
                Password
                <input name="password" type="password" autoFocus required />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button className="primary" type="submit">
                Enter studio
              </button>
            </form>
          ) : (
            <form
              className="login-card song-form"
              onSubmit={createSong}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="close"
                onClick={() => setModal(null)}
              >
                ×
              </button>
              <p className="eyebrow">New production</p>
              <h2>Create a song</h2>
              <label>
                Title
                <input
                  name="title"
                  defaultValue="Funk 80s Track"
                  required
                  maxLength={120}
                />
              </label>
              <label>
                Style prompt
                <textarea
                  name="stylePrompt"
                  defaultValue="Punchy neon funk with crisp drums and a warm analog bassline"
                  required
                />
              </label>
              <div className="form-row">
                <label>
                  BPM
                  <input
                    name="bpm"
                    type="number"
                    defaultValue={112}
                    min={40}
                    max={240}
                    required
                  />
                </label>
                <label>
                  Key
                  <input
                    name="key"
                    defaultValue="A minor"
                    required
                    maxLength={12}
                  />
                </label>
              </div>
              {error && <p className="form-error">{error}</p>}
              <button className="primary" type="submit">
                Create production
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<Studio />} />
    </Routes>
  );
}
