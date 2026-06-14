import { describe, expect, it } from "vitest";
import {
  agentRoleSchema,
  musicPartSchema,
  songProductionSchema,
  songSchema
} from "./index.js";

describe("shared schemas", () => {
  it("accepts supported agent roles", () => {
    expect(agentRoleSchema.parse("rhythm")).toBe("rhythm");
    expect(agentRoleSchema.safeParse("lead").success).toBe(false);
  });

  it("validates a song", () => {
    const song = songSchema.parse({
      id: "7cc00a76-8775-4b07-aeda-289e04862af9",
      slug: "funk-80s-track",
      title: "Funk 80s Track",
      stylePrompt: "Punchy neon funk",
      bpm: 112,
      key: "A minor",
      timeSignature: "4/4",
      status: "draft",
      createdAt: "2026-06-14T10:00:00.000Z",
      updatedAt: "2026-06-14T10:00:00.000Z"
    });

    expect(song.slug).toBe("funk-80s-track");
  });

  it("validates a Tone-compatible music part", () => {
    const part = musicPartSchema.parse({
      version: 1,
      role: "bass",
      instrument: "mono-synth",
      bars: 4,
      events: [{ time: "0:0:0", note: "A2", duration: "8n", velocity: 0.8 }]
    });
    expect(part.events).toHaveLength(1);
  });

  it("rejects invalid production event positions", () => {
    const result = songProductionSchema.safeParse({
      song: {
        id: "7cc00a76-8775-4b07-aeda-289e04862af9",
        slug: "test-song",
        title: "Test Song",
        stylePrompt: "Test",
        bpm: 100,
        key: "C",
        timeSignature: "4/4",
        status: "draft",
        createdAt: "2026-06-14T10:00:00.000Z",
        updatedAt: "2026-06-14T10:00:00.000Z"
      },
      parts: [
        {
          version: 1,
          role: "rhythm",
          instrument: "drums",
          bars: 4,
          events: [
            { time: "beat-one", note: "C1", duration: "8n", velocity: 1 }
          ]
        }
      ]
    });
    expect(result.success).toBe(false);
  });
});
