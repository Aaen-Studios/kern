import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { fontFamily } from "../fonts";

/**
 * Wordmark — "kern" typeset in JetBrains Mono, optionally with a tagline
 * lockup below. Types in character-by-character (monospace reveal) for the
 * intro, then holds. Always lowercase (brand voice).
 */
export interface WordmarkProps {
  /** Frame the wordmark begins typing in. */
  enterFrame?: number;
  /** Font size of "kern" in px. */
  size?: number;
  /** Optional tagline rendered beneath the wordmark. */
  tagline?: string;
  taglineSize?: number;
  /** Frame the tagline appears (defaults to enterFrame + reveal). */
  taglineFrame?: number;
  /** Frame the whole lockup begins exiting. */
  exitFrame?: number;
  style?: React.CSSProperties;
}

export const Wordmark: React.FC<WordmarkProps> = ({
  enterFrame = 0,
  size = 180,
  tagline,
  taglineSize = 40,
  taglineFrame,
  exitFrame,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Character-by-character reveal for "kern".
  const word = "kern";
  const revealLen = Math.floor(
    interpolate(
      frame - enterFrame,
      [0, 24],
      [0, word.length],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    ),
  );
  const shown = word.slice(0, Math.max(0, revealLen));
  // Caret blinks until the word is fully revealed, then fades.
  const caretOpacity =
    revealLen < word.length
      ? Math.floor((frame / 8) % 2) === 0 ? 1 : 0
      : interpolate(frame - enterFrame - 24, [0, 8], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const wordFade = spring({
    frame: frame - enterFrame,
    fps,
    config: { damping: 200 },
    durationInFrames: 12,
  });

  const tgFrame = taglineFrame ?? enterFrame + 30;
  const taglineSpring = spring({
    frame: frame - tgFrame,
    fps,
    config: { damping: 200, stiffness: 80 },
    durationInFrames: 18,
  });
  const taglineOpacity = interpolate(taglineSpring, [0, 1], [0, 1]);
  const taglineRise = interpolate(taglineSpring, [0, 1], [16, 0]);

  const exit =
    exitFrame !== undefined
      ? interpolate(frame, [exitFrame, exitFrame + 10], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: size * 0.18,
        opacity: wordFade * exit,
        ...style,
      }}
    >
      <div
        style={{
          fontFamily,
          fontSize: size,
          fontWeight: 600,
          color: COLORS.text,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          textTransform: "lowercase",
        }}
      >
        {shown}
        <span style={{ opacity: caretOpacity, color: COLORS.signalHigh }}>_</span>
      </div>
      {tagline && (
        <div
          style={{
            fontFamily,
            fontSize: taglineSize,
            fontWeight: 400,
            color: COLORS.signalLow,
            letterSpacing: "0.04em",
            textTransform: "lowercase",
            opacity: taglineOpacity * exit,
            transform: `translateY(${taglineRise}px)`,
          }}
        >
          {tagline}
        </div>
      )}
    </div>
  );
};
