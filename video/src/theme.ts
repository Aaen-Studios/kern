/**
 * kern brand tokens — single source of truth.
 * Mirrors documentation/DesignGuide.md §2 and src/styles/global.css `@theme`.
 *
 * Color is never used ornamentally:
 *   green   = running / active / primary
 *   amber   = warning / transitional
 *   crimson = error / fault / terminated
 *   gray    = standby / offline / muted
 */
export const COLORS = {
  bgCore: "#050506",
  bgSurface: "#0B0C10",
  gridBounds: "#161920",
  signalHigh: "#4CF5A0",
  signalLow: "#4C525E",
  warnVector: "#F5A04C",
  faultVector: "#F54C4C",
  /** Body text — Tailwind zinc-300. */
  text: "#D4D4D8",
} as const;

/** Color used for a given semantic dot color axis. */
export const DOT_COLOR_HEX: Record<DotColor, string> = {
  green: COLORS.signalHigh,
  amber: COLORS.warnVector,
  crimson: COLORS.faultVector,
  gray: COLORS.signalLow,
};

export type DotColor = "green" | "amber" | "crimson" | "gray";

/** Canvas + render constants. */
export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 20 * 30, // ~20s main composition (tight cut)
  loopDurationInFrames: 6 * 30, // 6s hero loop
} as const;

/** Music tempo — animations key off beat markers, not track length. */
export const BPM = 120;
/** Frames per beat at VIDEO.fps. */
export const FRAMES_PER_BEAT = Math.round((60 / BPM) * VIDEO.fps); // 15 frames
