# CollabJam Demo Music Repository

**This repository is the GitHub review surface for CollabJam Studio songs.**

CollabJam Studio uses this repository as a safe place to push AI-generated song branches, open pull requests, and merge final music productions without touching the main application source code.

## What This Repository Contains

Each song lives under `songs/<song-slug>/`:

```text
songs/
└── neon-velvet-getaway/
    ├── song.json
    └── parts/
        ├── rhythm.json
        ├── harmony.json
        └── bass.json
```

The files are structured JSON, not rendered audio files. CollabJam Studio reads the merged JSON and plays it in the browser with Tone.js.

## How CollabJam Uses This Repo

1. A user creates a song in CollabJam Studio.
2. CollabJam commits the base song metadata to `main`.
3. Three agent branches are created:

```text
song-slug/rhythm
song-slug/harmony
song-slug/bass
```

4. Each agent writes one JSON part file.
5. Each branch is pushed here.
6. CollabJam opens GitHub pull requests into `main`.
7. A human reviews and approves each PR.
8. The merged `main` branch becomes the final production.

## Branch Naming

Agent branches follow this pattern:

```text
<song-slug>/<role>
```

Examples:

```text
funk-80s-track-5/rhythm
funk-80s-track-5/harmony
funk-80s-track-5/bass
neon-velvet-getaway/rhythm
```

## Music Part Schema

Each part file follows this shape:

```json
{
  "version": 1,
  "role": "bass",
  "instrument": "mono-synth",
  "bars": 4,
  "events": [
    {
      "time": "0:0:0",
      "note": "A2",
      "duration": "4n",
      "velocity": 0.9
    }
  ]
}
```

## Roles

```text
rhythm   Drum and percussion pattern
harmony  Chords and harmonic texture
bass     Bassline and low-end movement
```

## Event Timing

Event times use:

```text
bar:beat:sixteenth
```

Example:

```text
0:0:0  Start of bar 1
0:1:0  Beat 2 of bar 1
1:0:0  Start of bar 2
```

Durations use Tone.js-style values:

```text
1m   one measure
4n   quarter note
8n   eighth note
16n  sixteenth note
32n  thirty-second note
```

## Human Review Workflow

This repository is intentionally reviewable. Pull requests show exactly what each agent changed:

- rhythm PR changes `parts/rhythm.json`
- harmony PR changes `parts/harmony.json`
- bass PR changes `parts/bass.json`

Reviewers can inspect the JSON before merging. Once all parts are merged, CollabJam Studio can play the final production from `main`.

## Notes for Demo Use

- This repo is separate from the CollabJam Studio app repository.
- It is safe for AI agents to push branches here.
- Keep `main` as the base branch for PRs.
- Do not store secrets in this repository.
- The app source code does not need to live here.

## Related Project

Main app repository:

```text
CollabJam Studio
```

The app manages song creation, agent orchestration, Git worktrees, GitHub PRs, human approval, and browser playback.
