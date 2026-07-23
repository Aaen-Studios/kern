import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";

const TAU = Math.PI * 2;

/**
 * RadarGlyph — the kern "Signal Radar" logo mark, rebuilt in code from
 * public/favicon.svg: near-black rounded square + soft radial green bloom +
 * one ring of 8 green dots + bright glowing core. Adds an animated sweep beam
 * (the polar-radar concept realized as a literal rotating gradient).
 *
 * Spec: documentation/DesignGuide.md §3.1.
 */
export interface RadarGlyphProps {
  /** Edge length in px. */
  size: number;
  /** 0–1 ignition progress (0 = dark, 1 = fully lit). */
  ignite?: number;
  /** Sweep rotation speed multiplier (1 = calm ambient). */
  sweepSpeed?: number;
  /** When true, beam rotates; when false, static glyph. */
  sweep?: boolean;
  style?: React.CSSProperties;
}

export const RadarGlyph: React.FC<RadarGlyphProps> = ({
  size,
  ignite = 1,
  sweepSpeed = 1,
  sweep = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cx = size / 2;
  const cy = size / 2;

  // Beam angle — calm ambient rotation, matching polarRadar's base rate.
  const sweepAngle =
    sweep ? (frame * 0.025 * sweepSpeed * fps * 0.33) % TAU : -Math.PI / 2;

  // Ring of 8 dots at 45° intervals (from favicon.svg).
  const ringRadius = size * 0.347; // 22.2/64
  const dots = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * TAU - Math.PI / 2;
    return {
      x: cx + Math.cos(a) * ringRadius,
      y: cy + Math.sin(a) * ringRadius,
    };
  });

  const coreR = size * 0.172; // 11/64 glow
  const coreSolidR = size * 0.109; // 7/64

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: size * 0.1875, // rx=12/64
        background: COLORS.bgCore,
        overflow: "hidden",
        boxShadow: ignite > 0.5
          ? `0 0 ${size * 0.25}px ${COLORS.signalHigh}${alpha(0.15)}`
          : "none",
        ...style,
      }}
    >
      {/* radial bloom */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 50% 50%, ${COLORS.signalHigh}${alpha(0.2 * ignite)} 0%, transparent 70%)`,
        }}
      />
      {/* sweep beam — a rotating conic wedge faded to transparent */}
      {sweep && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `conic-gradient(from ${sweepAngle}rad at 50% 50%, ${COLORS.signalHigh}${alpha(0.35 * ignite)} 0deg, ${COLORS.signalHigh}${alpha(0.05 * ignite)} 40deg, transparent 90deg, transparent 360deg)`,
            mixBlendMode: "screen",
          }}
        />
      )}
      {/* ring dots */}
      {dots.map((d, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: d.x,
            top: d.y,
            width: size * 0.081, // r=2.6 → d=5.2/64
            height: size * 0.081,
            borderRadius: "50%",
            background: COLORS.signalHigh,
            opacity: ignite,
            transform: "translate(-50%, -50%)",
            boxShadow: ignite > 0.6 ? `0 0 ${size * 0.06}px ${COLORS.signalHigh}` : "none",
          }}
        />
      ))}
      {/* core glow + solid core */}
      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          width: coreR * 2,
          height: coreR * 2,
          borderRadius: "50%",
          background: COLORS.signalHigh,
          opacity: 0.25 * ignite,
          transform: "translate(-50%, -50%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          width: coreSolidR * 2,
          height: coreSolidR * 2,
          borderRadius: "50%",
          background: COLORS.signalHigh,
          opacity: ignite,
          transform: "translate(-50%, -50%)",
          boxShadow: ignite > 0.4 ? `0 0 ${size * 0.12}px ${COLORS.signalHigh}` : "none",
        }}
      />
    </div>
  );
};

/** Convert 0–1 to two-digit hex alpha suffix. */
const alpha = (a: number): string => {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return v.toString(16).padStart(2, "0");
};

/** Helper kept for API symmetry; ignition is usually driven by spring(). */
export const igniteSpring = (
  frame: number,
  fps: number,
  delay = 0,
  from = 0,
  to = 1,
): number => {
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, mass: 1, stiffness: 80 },
    durationInFrames: 20,
    from,
    to,
  });
};

// Re-export interpolate so callers don't need a second import for timing curves.
export { interpolate };
