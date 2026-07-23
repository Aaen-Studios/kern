import { BPM, FRAMES_PER_BEAT } from "./theme";

/**
 * Audio timing + asset paths for the kern promo.
 *
 * Two layers:
 *   1. Background music — a swappable file at public/audio/music.mp3. If you
 *      drop a royalty-free track there (≈120 BPM), animations already line up
 *      because every scene's beats are multiples of FRAMES_PER_BEAT. Absent
 *      the file, the video renders silent (no error) — add it any time.
 *   2. Procedural SFX — synthesized at build time by scripts/gen-sfx.ts into
 *      public/audio/*.wav (blips for chip registrations, a sweep whoosh, a
 *      resolve chord). Run `bun run sfx` once to (re)generate them. They're
 *      layered into the timeline via <Series.Sequence> in KernVideo.tsx.
 */
export const MUSIC_SRC = "audio/music.wav";

/** Absolute (composition-wide) frame of each scene boundary, beat-aligned.
 * Tight 20s cut — each scene pared to its essential beats. */
export const SCENE_FRAMES = {
  intro: { start: 0, length: 3 * 30 }, // 90
  universality: { start: 3 * 30, length: 7 * 30 }, // 210
  telemetry: { start: 10 * 30, length: 5 * 30 }, // 150
  outro: { start: 15 * 30, length: 5 * 30 }, // 150
} as const;

export const TOTAL_FRAMES =
  SCENE_FRAMES.intro.length +
  SCENE_FRAMES.universality.length +
  SCENE_FRAMES.telemetry.length +
  SCENE_FRAMES.outro.length; // 600 = 20s @ 30fps

/** Every Nth beat — handy for marking accents. */
export const beatFrame = (beat: number): number => beat * FRAMES_PER_BEAT;

export const SFX = {
  blip: "audio/sfx-blip.wav",
  resolve: "audio/sfx-resolve.wav",
} as const;

/** Absolute frames where chip-registration blips fire (one per server chip).
 * Offset matches the chip stagger (24f) + 16f ignite delay in Universality. */
const CHIP_STAGGER = 24;
const CHIP_IGNITE_DELAY = 16;
export const BLIP_FRAMES = Array.from({ length: 5 }, (_, i) =>
  SCENE_FRAMES.universality.start + 15 + i * CHIP_STAGGER + CHIP_IGNITE_DELAY,
);

/** Resolve chord on the outro lockup. */
export const RESOLVE_FRAME = SCENE_FRAMES.outro.start + 30;

export { BPM, FRAMES_PER_BEAT };
