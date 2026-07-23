import React from "react";
import { useCurrentFrame } from "remotion";
import { DotGrid } from "./DotGrid";
import { reactorChannel, seededRandom } from "../lib/shaders";

/**
 * ReactorBar — a live CPU/RAM activity strip rendered through the ported
 * reactorChannel shader. Wide and short (e.g. 2 rows), matching the in-app
 * detail-header channel. CPU and RAM animate over time to look "live".
 */
export interface ReactorBarProps {
  width: number;
  rowHeight?: number;
  rows?: number;
  /** Seed for deterministic comet/noise artifacts. */
  seed?: number;
  /** Base cpu/ram the bar centers around (0–1). */
  cpu?: number;
  ram?: number;
  activity?: number;
  style?: React.CSSProperties;
}

export const ReactorBar: React.FC<ReactorBarProps> = ({
  width,
  rowHeight = 14,
  rows = 2,
  seed = 7,
  cpu = 0.4,
  ram = 0.5,
  activity = 0.4,
  style,
}) => {
  const frame = useCurrentFrame();
  // Columns sized so each cell is ~square.
  const cols = Math.round(width / rowHeight);
  const height = rows * rowHeight;

  // Telemetry wanders gently around the base values to feel alive.
  const liveCpu = clamp(cpu + Math.sin(frame * 0.05) * 0.12, 0, 1);
  const liveRam = clamp(ram + Math.sin(frame * 0.02 + 1) * 0.05, 0, 1);
  const liveActivity = clamp(
    activity + (Math.sin(frame * 0.08) + 1) * 0.15,
    0,
    1,
  );

  const buffer = reactorChannel({
    cols,
    rows,
    frame,
    cpu: liveCpu,
    ram: liveRam,
    activity: liveActivity,
    random: seededRandom(seed + frame),
  });

  return (
    <DotGrid
      buffer={buffer}
      cols={cols}
      rows={rows}
      width={width}
      height={height}
      dotRadius={Math.max(1, rowHeight * 0.28)}
      style={{ ...style }}
    />
  );
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
