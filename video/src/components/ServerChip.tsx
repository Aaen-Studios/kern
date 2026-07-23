import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { fontFamily } from "../fonts";

/**
 * ServerChip — a "registered instance" pill, matching the kern instance list
 * aesthetic: monospace label + a status dot. Slides in from the left with a
 * spring; the status dot ignites (gray → green) when the instance "registers".
 *
 * Voice (DesignGuide §3.6): lowercase, slash-delimited server type tokens.
 */
export interface ServerChipProps {
  /** e.g. "minecraft/java". */
  label: string;
  /** Frame the chip slides in. */
  enterFrame: number;
  /** Frame the status dot ignites green. */
  igniteFrame: number;
  /** Index for vertical stagger positioning handled by parent. */
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}

export const ServerChip: React.FC<ServerChipProps> = ({
  label,
  enterFrame,
  igniteFrame,
  width = 540,
  height = 72,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame: frame - enterFrame,
    fps,
    config: { damping: 200, mass: 1, stiffness: 90 },
    durationInFrames: 16,
  });
  const x = interpolate(enter, [0, 1], [-120, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  // Status dot ignition: gray → green glow.
  const ignite = spring({
    frame: frame - igniteFrame,
    fps,
    config: { damping: 200 },
    durationInFrames: 10,
  });
  const dotColor = interpolate(ignite, [0, 1], [
    parseIntHex(COLORS.signalLow),
    parseIntHex(COLORS.signalHigh),
  ]);
  const dotGlow = interpolate(ignite, [0, 1], [0, 12]);

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "0 24px",
        background: COLORS.bgSurface,
        border: `1px solid ${COLORS.gridBounds}`,
        borderRadius: 8,
        opacity,
        transform: `translateX(${x}px)`,
        fontFamily,
        ...style,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: rgb(dotColor),
          boxShadow: dotGlow > 0 ? `0 0 ${dotGlow}px ${rgb(dotColor)}` : "none",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: COLORS.text,
          fontSize: 26,
          letterSpacing: "0.02em",
          textTransform: "lowercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          marginLeft: "auto",
          color: COLORS.signalLow,
          fontSize: 16,
          textTransform: "lowercase",
        }}
      >
        registered
      </span>
    </div>
  );
};

/** Parse #rrggbb → [r,g,b]. */
const parseIntHex = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
};

/** Format an [r,g,b] tuple as a CSS rgb() string. */
const rgb = (c: readonly [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
