/**
 * Ported dot-matrix shaders — faithful ports of kern's in-app shader engine
 * (src/components/matrix/shaders/*.ts), adapted for Remotion's frame-driven
 * rendering instead of a live telemetry tick.
 *
 * Each shader is a pure function: (frame, grid) → flat buffer of intensity/color.
 * Same signature contract as kern's `MatrixShader`, minus the live telemetry
 * (we pass fixed/animated values instead).
 *
 * Spec: documentation/DesignGuide.md §4.
 */
import type { DotColor } from "../theme";

const TAU = Math.PI * 2;

export interface DotNode {
  /** Normalized 0.0–1.0. */
  intensity: number;
  color: DotColor;
}

export type MatrixBuffer = DotNode[];

export interface ShaderInput {
  cols: number;
  rows: number;
  /** Equivalent to kern's `tick` — advance this per frame. */
  frame: number;
  /** Telemetry shaping the shader (cpu/ram/activity). 0–1 unless noted. */
  cpu?: number;
  ram?: number;
  activity?: number;
  /** Seedable RNG so renders are deterministic (no Math.random at render time). */
  random: () => number;
}

/** Deterministic mulberry32 PRNG — stable per-seed renders. */
export const seededRandom = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Blueprint A — Polar Radar (rotating sweep beam).
 * Ported from src/components/matrix/shaders/polarRadar.ts.
 *
 * Sweep speed escalates with cpu; under heavy load the field gains amber
 * noise-spike artifacts. Trail uses true modular circular distance so it wraps
 * seamlessly across 2π.
 */
export const polarRadar = (input: ShaderInput): MatrixBuffer => {
  const { cols, rows, frame, random } = input;
  const cpu = input.cpu ?? 0;
  const buffer: MatrixBuffer = [];
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;
  const sweepAngle = (frame * (0.025 + cpu * 0.06)) % TAU;
  const trailWidth = TAU * 0.35;

  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) - centerX;
    const y = Math.floor(i / cols) - centerY;
    const nodeAngle = Math.atan2(y, x);
    const diff = ((sweepAngle - nodeAngle) % TAU + TAU) % TAU;
    let intensity = diff < trailWidth ? 1.0 - diff / trailWidth : 0.08;
    if (cpu > 0.9 && random() > 0.85) intensity = 1.0;
    buffer.push({
      intensity,
      color: cpu > 0.9 ? "amber" : "green",
    });
  }
  return buffer;
};

/**
 * Blueprint B — Sine Ripple (concentric waves from origin).
 * Ported from src/components/matrix/shaders/sineRipple.ts.
 */
export const sineRipple = (input: ShaderInput): MatrixBuffer => {
  const { cols, rows, frame } = input;
  const buffer: MatrixBuffer = [];
  for (let i = 0; i < cols * rows; i++) {
    const x = i % cols;
    const y = Math.floor(i / cols);
    const distance = Math.sqrt(x * x + y * y);
    const waveValue = Math.sin(distance - frame * 0.08);
    const intensity = Math.max(0.1, (waveValue + 1.0) / 2.0);
    buffer.push({ intensity, color: "green" });
  }
  return buffer;
};

/**
 * Reactor Channel — dense horizontal CPU/RAM activity strip.
 * Ported from src/components/matrix/shaders/reactorChannel.ts.
 *
 * Row 0: CPU shimmer wave + activity comets (amber under load).
 * Row 1: RAM fill (left-anchored, fluid-surface leading edge).
 */
export const reactorChannel = (input: ShaderInput): MatrixBuffer => {
  const { cols, rows, frame, random } = input;
  const cpu = Math.min(1, Math.max(0, input.cpu ?? 0));
  const ram = Math.min(1, Math.max(0, input.ram ?? 0));
  const activity = Math.max(0, input.activity ?? 0);
  const buffer: MatrixBuffer = [];

  const ramEdge = Math.round(ram * cols);
  const speed = 0.06 + cpu * 0.22;
  const wavePhase = frame * speed;
  const cometCount = 1 + Math.floor(activity * 4);
  const cometSpeed = 0.04 + activity * 0.5;
  // (In the video we always render the active state, so `running` is implicit.)

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let intensity = 0.05;
      let color: DotColor = "green";

      if (y === 0) {
        // CPU shimmer
        const wave = (Math.sin(x * 0.5 - wavePhase) + 1) / 2;
        intensity = 0.08 + wave * (0.15 + cpu * 0.85);
        if (cpu > 0.9 && random() > 0.78) intensity = 1.0;
        color = cpu > 0.9 ? "amber" : "green";

        // Activity comets
        if (activity > 0) {
          let comet = 0;
          for (let c = 0; c < cometCount; c++) {
            const phase = ((c + 1) / (cometCount + 1)) * cols;
            const pos = (phase + frame * cometSpeed * cols) % (cols + 4) - 2;
            const d = Math.abs(x - pos);
            comet = Math.max(comet, Math.max(0, 1 - d / 1.5));
          }
          intensity = Math.max(
            intensity,
            comet * (0.4 + Math.min(activity, 1) * 0.6),
          );
        }
      } else {
        // RAM fill
        if (x < ramEdge) {
          const edgeBoost = x === ramEdge - 1 ? 0.25 : 0;
          const shimmer = (Math.sin(frame * 0.2 + x * 0.4) + 1) / 2;
          intensity = 0.5 + shimmer * 0.35 + edgeBoost;
          color = ram > 0.85 ? "amber" : "green";
        } else {
          intensity = 0.06;
          color = "gray";
        }
      }
      buffer.push({ intensity, color });
    }
  }
  return buffer;
};
