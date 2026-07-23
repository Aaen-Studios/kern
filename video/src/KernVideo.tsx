import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  Series,
  staticFile,
} from "remotion";
import { Intro } from "./scenes/Intro";
import { Universality } from "./scenes/Universality";
import { Telemetry } from "./scenes/Telemetry";
import { Outro } from "./scenes/Outro";
import {
  MUSIC_SRC,
  SCENE_FRAMES,
  SFX,
  BLIP_FRAMES,
  RESOLVE_FRAME,
} from "./audio";

/**
 * KernVideo — the main ~35s promo composition.
 *
 * Four scenes in a Series, beat-aligned to a 120 BPM grid. Background music
 * (optional, swappable at public/audio/music.mp3) plays under everything;
 * procedural SFX fire at specific frames via positioned Sequences.
 */
export const KernVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#050506" }}>
      <Series>
        <Series.Sequence
          durationInFrames={SCENE_FRAMES.intro.length}
          name="intro"
        >
          <Intro />
        </Series.Sequence>
        <Series.Sequence
          durationInFrames={SCENE_FRAMES.universality.length}
          name="universality"
        >
          <Universality />
        </Series.Sequence>
        <Series.Sequence
          durationInFrames={SCENE_FRAMES.telemetry.length}
          name="telemetry"
        >
          <Telemetry />
        </Series.Sequence>
        <Series.Sequence
          durationInFrames={SCENE_FRAMES.outro.length}
          name="outro"
        >
          <Outro />
        </Series.Sequence>
      </Series>

      {/* SFX — each placed at an absolute frame via a short Sequence. */}
      {BLIP_FRAMES.map((f, i) => (
        <Sequence key={`blip-${i}`} from={f} durationInFrames={20}>
          <Audio src={staticFile(SFX.blip)} volume={0.4} />
        </Sequence>
      ))}
      <Sequence from={RESOLVE_FRAME} durationInFrames={90}>
        <Audio src={staticFile(SFX.resolve)} volume={0.5} />
      </Sequence>

      {/* Background music — swappable file. A silent placeholder ships at
          public/audio/music.wav; replace it with a real ~120 BPM track. */}
      <Audio src={staticFile(MUSIC_SRC)} volume={0.4} />
    </AbsoluteFill>
  );
};
