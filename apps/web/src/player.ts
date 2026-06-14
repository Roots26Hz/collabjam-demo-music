import * as Tone from "tone";
import type { AgentRole, MusicPart, Song } from "@collabjam/shared";

type Player = {
  stop: () => void;
  setMuted: (role: AgentRole, muted: boolean) => void;
};

export async function playProduction(
  song: Song,
  parts: MusicPart[],
  muted: Set<AgentRole>,
  onStop: () => void
): Promise<Player> {
  await Promise.race([
    Tone.start(),
    new Promise<void>((resolve) => window.setTimeout(resolve, 500))
  ]);
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  Tone.getTransport().bpm.value = song.bpm;

  const channels = {
    rhythm: new Tone.Channel({
      volume: -5,
      mute: muted.has("rhythm")
    }).toDestination(),
    harmony: new Tone.Channel({
      volume: -12,
      mute: muted.has("harmony")
    }).toDestination(),
    bass: new Tone.Channel({
      volume: -7,
      mute: muted.has("bass")
    }).toDestination()
  };
  const kick = new Tone.MembraneSynth().connect(channels.rhythm);
  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 3000,
    octaves: 1.5
  }).connect(channels.rhythm);
  const harmony = new Tone.PolySynth(Tone.Synth).connect(channels.harmony);
  const bass = new Tone.MonoSynth({
    oscillator: { type: "square" },
    filterEnvelope: {
      attack: 0.01,
      decay: 0.2,
      sustain: 0.3,
      release: 0.5,
      baseFrequency: 90,
      octaves: 2
    }
  }).connect(channels.bass);

  for (const part of parts) {
    for (const event of part.events) {
      Tone.getTransport().schedule((time) => {
        if (part.role === "rhythm") {
          if (event.note === "F#1")
            hat.triggerAttackRelease("32n", time, event.velocity);
          else
            kick.triggerAttackRelease(
              event.note,
              event.duration,
              time,
              event.velocity
            );
        } else if (part.role === "harmony") {
          harmony.triggerAttackRelease(
            event.note,
            event.duration,
            time,
            event.velocity
          );
        } else {
          bass.triggerAttackRelease(
            event.note,
            event.duration,
            time,
            event.velocity
          );
        }
      }, event.time);
    }
  }

  const bars = Math.max(...parts.map((part) => part.bars), 1);
  Tone.getTransport().scheduleOnce(() => {
    player.stop();
    onStop();
  }, `${bars}:0:0`);

  const player: Player = {
    stop() {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      kick.dispose();
      hat.dispose();
      harmony.dispose();
      bass.dispose();
      Object.values(channels).forEach((channel) => channel.dispose());
    },
    setMuted(role, isMuted) {
      channels[role].mute = isMuted;
    }
  };
  Tone.getTransport().start("+0.05");
  return player;
}
