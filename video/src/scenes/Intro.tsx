import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { polarRadar, seededRandom } from "../lib/shaders";
import { DotGrid } from "../components/DotGrid";
import { RadarGlyph } from "../components/RadarGlyph";
import { Wordmark } from "../components/Wordmark";

/**
 * Intro (~3s / 90 frames).
 * Black canvas → ambient polar-radar dot grid fades up → radar glyph ignites
 * (sweep beam, ring dots, core bloom) → "kern" wordmark types in.
 */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Ambient grid behind the glyph — large, dim, slow sweep.
  const cols = 96;
  const rows = 54;
  const buffer = polarRadar({
    cols,
    rows,
    frame,
    cpu: 0,
    random: seededRandom(101),
  });

  const gridOpacity = interpolate(frame, [0, 15], [0, 0.5], {
    extrapolateRight: "clamp",
  });

  // Glyph ignition curve — fires fast.
  const ignite = spring({
    frame: frame - 10,
    fps,
    config: { damping: 200, mass: 1, stiffness: 90 },
    durationInFrames: 22,
  });
  const glyphScale = interpolate(ignite, [0, 1], [0.6, 1]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: COLORS.bgCore,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 80,
      }}
    >
      {/* ambient radar field */}
      <div style={{ position: "absolute", inset: 0, opacity: gridOpacity }}>
        <DotGrid
          buffer={buffer}
          cols={cols}
          rows={rows}
          width={1920}
          height={1080}
          dotRadius={1.2}
        />
      </div>

      <RadarGlyph size={260} ignite={ignite} sweep style={{ transform: `scale(${glyphScale})` }} />

      <Wordmark enterFrame={34} size={160} />
    </div>
  );
};
