import type { MatrixBuffer, MatrixShader } from "../../../types/matrix";

/**
 * Blueprint B — Sine Ripple Canvas (Initialization Sequence).
 * Spec: documentation/DesignGuide.md §4.
 *
 * Generates circular waves moving outward from the origin. Used during
 * backend service spin-ups.
 */
export const sineRippleShader: MatrixShader = (ctx) => {
  const { tick, cols, rows } = ctx;
  const buffer: MatrixBuffer = [];

  for (let i = 0; i < cols * rows; i++) {
    const x = i % cols;
    const y = Math.floor(i / cols);

    // Measure geometric Euclidean distance from origin.
    const distance = Math.sqrt(x * x + y * y);

    // Wave propagation velocity — kept slow so ripples expand gently.
    const waveValue = Math.sin(distance - tick * 0.08);
    const intensity = Math.max(0.1, (waveValue + 1.0) / 2.0);

    buffer.push({ intensity, color: "green" });
  }

  return buffer;
};
