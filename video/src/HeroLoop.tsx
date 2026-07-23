import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { COLORS, VIDEO } from "./theme";
import { polarRadar, seededRandom } from "./lib/shaders";
import { DotGrid } from "./components/DotGrid";
import { RadarGlyph } from "./components/RadarGlyph";

/**
 * HeroLoop — a 6s seamless loop for landing-page hero backgrounds.
 *
 * Just the radar glyph idling (slow sweep) over a dim ambient polar-radar
 * field, with a gentle breathing scale on the glyph. Designed to repeat
 * without a visible seam: the sweep's modular math and the symmetric pulse
 * mean frame 0 and frame N are visually continuous.
 */
export const HeroLoop: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const cols = 96;
  const rows = 54;
  const buffer = polarRadar({
    cols,
    rows,
    frame,
    cpu: 0,
    random: seededRandom(606),
  });

  // Breathing scale — a full sine cycle across the loop duration so it loops.
  const breath = Math.sin((frame / durationInFrames) * Math.PI * 2);
  const scale = interpolate(breath, [-1, 1], [0.96, 1.04]);
  const glow = interpolate(breath, [-1, 1], [0.7, 1]);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgCore }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.4 }}>
        <DotGrid
          buffer={buffer}
          cols={cols}
          rows={rows}
          width={VIDEO.width}
          height={VIDEO.height}
          dotRadius={1.2}
        />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <RadarGlyph size={420} ignite={glow} sweep style={{ transform: `scale(${scale})` }} />
      </div>
    </AbsoluteFill>
  );
};
