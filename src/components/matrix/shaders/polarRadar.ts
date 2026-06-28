import type { MatrixBuffer, MatrixShader } from "../../../types/matrix";

const TAU = Math.PI * 2;

/**
 * Blueprint A — Polar Coordinated Radar (Standard Operational Sweep).
 * Spec: documentation/DesignGuide.md §4.
 *
 * A rotating beam sweeps clockwise from the center, leaving a trailing
 * falloff behind it. Sweep speed escalates with CPU load; under heavy load
 * the field gains amber noise-spike artifacts.
 *
 * The trailing intensity uses the true circular (modular) distance between the
 * beam and each node, so the trail wraps continuously across the 2π boundary —
 * no tear or jump when the beam completes a revolution.
 */
export const polarRadarShader: MatrixShader = (ctx) => {
  const { tick, cols, rows, telemetry } = ctx;
  const buffer: MatrixBuffer = [];

  // Dynamic center index based on container bounds.
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;

  // Sweep speed escalates with processor load. The base rate is kept slow so
  // the field reads as a calm ambient sweep rather than a strobe.
  const sweepAngle = (tick * (0.025 + telemetry.cpu * 0.06)) % TAU;

  // The trail occupies this fraction of the circle behind the beam.
  const trailWidth = TAU * 0.35;

  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) - centerX;
    const y = Math.floor(i / cols) - centerY;

    // Circular distance: how far behind the beam this node sits, in [0, TAU).
    // 0 = node is at the beam (brightest); trailWidth = trail has fully faded.
    const nodeAngle = Math.atan2(y, x);
    let diff = ((sweepAngle - nodeAngle) % TAU + TAU) % TAU;

    // Smooth trailing falloff within the trail, floor elsewhere.
    let intensity = diff < trailWidth ? 1.0 - diff / trailWidth : 0.08;

    // Introduce noise spike artifacts if the server exceeds load limits.
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
