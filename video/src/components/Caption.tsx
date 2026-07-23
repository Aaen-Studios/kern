import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { fontFamily } from "../fonts";

/**
 * Caption — lowercase kinetic typography. kern's voice is terse, monospace,
 * no punctuation hype (DesignGuide §3.6). Lines fade + rise into place with
 * a soft spring; exit is a quick fade.
 */
export interface CaptionProps {
  text: string;
  /** Frame (relative to scene) the caption enters. */
  enterFrame?: number;
  /** Frame the caption begins exiting. Undefined = hold. */
  exitFrame?: number;
  /** Font size in px. */
  size?: number;
  /** Text color (defaults to signal green — the primary accent). */
  color?: string;
  /** Letter spacing in em. */
  tracking?: number;
  style?: React.CSSProperties;
}

export const Caption: React.FC<CaptionProps> = ({
  text,
  enterFrame = 0,
  exitFrame,
  size = 72,
  color = COLORS.signalHigh,
  tracking = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame: frame - enterFrame,
    fps,
    config: { damping: 200, mass: 1, stiffness: 90 },
    durationInFrames: 18,
  });
  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const rise = interpolate(enter, [0, 1], [24, 0]);

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
        fontFamily,
        fontSize: size,
        fontWeight: 600,
        color,
        letterSpacing: `${tracking}em`,
        opacity: opacity * exit,
        transform: `translateY(${rise}px)`,
        textTransform: "lowercase",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {text}
    </div>
  );
};
