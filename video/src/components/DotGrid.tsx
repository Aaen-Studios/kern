import React from "react";
import { COLORS, DOT_COLOR_HEX } from "../theme";
import type { MatrixBuffer } from "../lib/shaders";

/**
 * DotGrid — the signature kern dot-matrix canvas.
 *
 * Renders a flat shader buffer onto a Cartesian grid of round dots, matching
 * the in-app MatrixViewport aesthetic: 1px dots, tight spacing, glow on
 * high-intensity nodes (intensity > 0.8). Inactive nodes show at gridBounds.
 *
 * For render performance we precompute dot styles once and inline them; the
 * parent recomputes the buffer each frame and passes it down.
 */
export interface DotGridProps {
  /** Flat buffer of cols*rows nodes from a shader. */
  buffer: MatrixBuffer;
  cols: number;
  rows: number;
  /** Pixel width of the grid area. */
  width: number;
  /** Pixel height of the grid area. */
  height: number;
  /** Base dot radius in px (default 1). */
  dotRadius?: number;
  /** Opacity multiplier for the whole grid (for fades). */
  opacity?: number;
  /** Extra style on the container. */
  style?: React.CSSProperties;
}

export const DotGrid: React.FC<DotGridProps> = ({
  buffer,
  cols,
  rows,
  width,
  height,
  dotRadius = 1,
  opacity = 1,
  style,
}) => {
  const cellW = width / cols;
  const cellH = height / rows;
  // Dots sit at cell centers; glow scales with radius.
  const glow = dotRadius * 3;

  const dots = buffer.map((node, i) => {
    const x = (i % cols) * cellW + cellW / 2;
    const y = Math.floor(i / cols) * cellH + cellH / 2;
    const hex = DOT_COLOR_HEX[node.color];
    const bright = node.intensity;
    // Anything dimmer than the floor fades to the inactive grid color.
    const useGrid = bright <= 0.08;
    const color = useGrid ? COLORS.gridBounds : hex;
    const alpha = useGrid ? 1 : Math.max(0.12, bright);
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: dotRadius * 2,
          height: dotRadius * 2,
          borderRadius: "50%",
          background: color,
          opacity: alpha,
          transform: "translate(-50%, -50%)",
          boxShadow:
            bright > 0.8 ? `0 0 ${glow}px ${color}` : "none",
          willChange: "opacity",
        }}
      />
    );
  });

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        opacity,
        ...style,
      }}
    >
      {dots}
    </div>
  );
};
