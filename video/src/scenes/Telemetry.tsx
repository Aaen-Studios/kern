import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { polarRadar, seededRandom } from "../lib/shaders";
import { DotGrid } from "../components/DotGrid";
import { ReactorBar } from "../components/ReactorBar";
import { RadarGlyph } from "../components/RadarGlyph";
import { Caption } from "../components/Caption";
import { fontFamily } from "../fonts";

/**
 * Telemetry (~5s / 150 frames).
 * A mock "instance detail" panel: radar glyph idling (sweeping), a live
 * reactor channel strip (CPU wave + RAM fill), and numeric readouts that
 * tick. Caption: "live signal."
 */
export const Telemetry: React.FC = () => {
  const frame = useCurrentFrame();

  // Background radar field — moderate cpu for a brisker sweep.
  const cols = 96;
  const rows = 54;
  const buffer = polarRadar({
    cols,
    rows,
    frame,
    cpu: 0.35,
    random: seededRandom(303),
  });
  const bgOpacity = interpolate(frame, [0, 14, 134, 150], [0, 0.22, 0.22, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Numeric readouts that wander to feel live.
  const cpu = Math.round(clamp(0.4 + Math.sin(frame * 0.05) * 0.18, 0, 0.99) * 100);
  const ram = Math.round(clamp(0.55 + Math.sin(frame * 0.02) * 0.08, 0, 0.95) * 100);

  const panelFade = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: COLORS.bgCore,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "absolute", inset: 0, opacity: bgOpacity }}>
        <DotGrid
          buffer={buffer}
          cols={cols}
          rows={rows}
          width={1920}
          height={1080}
          dotRadius={1.2}
        />
      </div>

      {/* Instance detail panel */}
      <div
        style={{
          position: "relative",
          width: 1100,
          padding: "48px 56px",
          background: COLORS.bgSurface,
          border: `1px solid ${COLORS.gridBounds}`,
          borderRadius: 12,
          opacity: panelFade,
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        {/* Header: glyph + instance name */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <RadarGlyph size={72} ignite={1} sweep sweepSpeed={1.4} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontFamily,
                color: COLORS.text,
                fontSize: 34,
                textTransform: "lowercase",
                letterSpacing: "-0.01em",
              }}
            >
              minecraft/java
            </span>
            <span
              style={{
                fontFamily,
                color: COLORS.signalHigh,
                fontSize: 18,
                textTransform: "lowercase",
                letterSpacing: "0.04em",
              }}
            >
              running · pid 42891
            </span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 48 }}>
            <Readout label="cpu" value={`${cpu}%`} color={cpu > 85 ? COLORS.warnVector : COLORS.signalHigh} />
            <Readout label="ram" value={`${ram}%`} color={ram > 85 ? COLORS.warnVector : COLORS.signalHigh} />
          </div>
        </div>

        <ReactorBar width={1100 - 112} cpu={cpu / 100} ram={ram / 100} activity={0.5} />

        <Caption
          text="live signal."
          enterFrame={25}
          exitFrame={130}
          size={64}
          tracking={0.02}
          style={{ alignSelf: "center", marginTop: 8 }}
        />
      </div>
    </div>
  );
};

const Readout: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
    <span style={{ fontFamily, color: COLORS.signalLow, fontSize: 16, textTransform: "lowercase" }}>
      {label}
    </span>
    <span style={{ fontFamily, color, fontSize: 30, fontVariantNumeric: "tabular-nums" }}>
      {value}
    </span>
  </div>
);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
