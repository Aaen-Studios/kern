import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { sineRipple, seededRandom } from "../lib/shaders";
import { DotGrid } from "../components/DotGrid";
import { ServerChip } from "../components/ServerChip";
import { Caption } from "../components/Caption";

const SERVERS = [
  "minecraft/java",
  "discord/bot",
  "node/api",
  "rust/service",
  "python/worker",
];

/**
 * Universality (~7s / 210 frames).
 * Server-type chips register one-by-one (slide in, status dot ignites green).
 * A faint sine-ripple field plays behind, evoking the "initialization
 * sequence". Caption: "any server."
 */
export const Universality: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Background ripple field — slow initialization waves.
  const cols = 80;
  const rows = 45;
  const buffer = sineRipple({
    cols,
    rows,
    frame,
    random: seededRandom(202),
  });
  const bgOpacity = interpolate(frame, [0, 14, 192, 210], [0, 0.18, 0.18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Chips enter staggered every 24 frames; ignite 16 frames after.
  const stagger = 24;

  // Caption enters once chips are underway; exits near the scene tail.
  const captionExit = 188;

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

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 60,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {SERVERS.map((s, i) => (
            <ServerChip
              key={s}
              label={s}
              enterFrame={15 + i * stagger}
              igniteFrame={15 + i * stagger + 16}
            />
          ))}
        </div>

        <Caption
          text="any server."
          enterFrame={Math.round(fps * 1.5)}
          exitFrame={captionExit}
          size={88}
          tracking={-0.02}
          style={{ marginTop: 30 }}
        />
      </div>
    </div>
  );
};
