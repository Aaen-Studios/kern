import type { MatrixBuffer, MatrixShader } from "../../../types/matrix";

/**
 * Blueprint A — Polar Coordinated Radar (Standard Operational Sweep).
 * Spec: documentation/DesignGuide.md §4.
 *
 * Calculates the angular difference between a rotating beam vector and the
 * current node point. Sweep speed escalates with CPU load; under heavy load
 * the field gains amber noise-spike artifacts.
 */
export const polarRadarShader: MatrixShader = (ctx) => {
  const { tick, cols, rows, telemetry } = ctx;
  const buffer: MatrixBuffer = [];

  // Dynamic center index based on container bounds.
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;

  // Speed escalates gracefully based on actual processor load.
  const sweepAngle = (tick * (0.08 + telemetry.cpu * 0.32)) % (Math.PI * 2);

  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) - centerX;
    const y = Math.floor(i / cols) - centerY;

    const nodeAngle = Math.atan2(y, x) + Math.PI; // Normalized angle.
    const angularDiff = Math.abs(sweepAngle - nodeAngle);

    // Smooth trailing falloff calculation.
    let intensity = Math.max(0.08, 1.0 - angularDiff * 0.75);

    // Introduce noise spike artifacts if server exceeds load limits.
    if (telemetry.cpu > 0.9 && Math.random() > 0.85) {
      intensity = 1.0;
    }

    buffer.push({
      intensity,
      color: telemetry.cpu > 0.9 ? "amber" : "green",
    });
  }

  return buffer;
};
