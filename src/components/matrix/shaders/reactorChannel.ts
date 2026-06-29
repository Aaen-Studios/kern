import type { MatrixBuffer, MatrixShader } from "../../../types/matrix";

/**
 * Reactor Channel — a horizontal multi-signal strip for the detail header.
 *
 * Where the polar radar is a status glyph, this is a dense activity *channel*:
 * a wide, short grid where each layer maps to one live signal. Designed to fill
 * the gap between the instance name and the lifecycle buttons.
 *
 * Two-row layout:
 *   ┌───────────────────────────────────────────┐  row 0  CPU shimmer +
 *   │ ░░░▒▒▓▓██●▓▓▒▒░░░░░░░●░░░░░░░░░░░░░░░░░░░ │         activity comets
 *   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒░░░░░░░░░░░░░░░░░░░░░░░░░ │  row 1  RAM fill (L→R)
 *   └───────────────────────────────────────────┘
 *
 * Signals (all 0..1 unless noted):
 *  • cpu      → top-row shimmer amplitude, speed, and amber-spike intensity.
 *               Under heavy load (>0.9) the channel gains noise-spike artifacts.
 *  • ram      → bottom-row fill whose width = ram fraction (left-anchored).
 *  • activity → traveling "comet" pulses riding the top row; density + speed
 *               scale with log churn. A silent stream reads as a near-empty
 *               baseline; a burst fires bright pulses left→right.
 *
 * Non-running states show a calm idle baseline so the bar reads as a live
 * element rather than a dead strip.
 */
export const reactorChannelShader: MatrixShader = (ctx) => {
  const { tick, cols, rows, telemetry } = ctx;
  const buffer: MatrixBuffer = [];

  // Clamp + default the inputs. Host metrics may omit `activity`.
  const cpu = Math.min(1, Math.max(0, telemetry.cpu));
  const ram = Math.min(1, Math.max(0, telemetry.ram));
  const activity = Math.max(0, telemetry.activity ?? 0);

  // The RAM fill spans this many columns (left-anchored) on the bottom row(s).
  const ramEdge = Math.round(ram * cols);

  // A CPU-driven traveling wave: phase advances faster as load rises so the
  // channel "breathes" quicker under work.
  const speed = 0.06 + cpu * 0.22;
  const wavePhase = tick * speed;

  // Comet pulses ride the top row. Density + speed scale with log churn.
  const cometCount = 1 + Math.floor(activity * 4);
  const cometSpeed = 0.04 + activity * 0.5;

  const running = telemetry.status !== "stopped" && telemetry.status !== "idle";

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let intensity = 0.05; // baseline floor — the track is always faintly lit
      let color: MatrixBuffer[number]["color"] = "green";

      // ── Top row: CPU shimmer + activity comets ─────────────────────────────
      if (y === 0) {
        if (running) {
          // Traveling sine; amplitude + base brightness scale with cpu.
          const wave = (Math.sin(x * 0.5 - wavePhase) + 1) / 2;
          intensity = 0.08 + wave * (0.15 + cpu * 0.85);
          // Noise spikes under heavy load — the channel "crackles".
          if (cpu > 0.9 && Math.random() > 0.78) intensity = 1.0;
        } else {
          // Idle: a slow, dim breathing pulse so the strip never looks dead.
          intensity = 0.06 + ((Math.sin(tick * 0.05 + x * 0.3) + 1) / 2) * 0.04;
        }
        color = cpu > 0.9 ? "amber" : "green";

        // Overlay traveling activity comets. Each contributes a bright Gaussian
        // peak; sum a few evenly-phased ones so a busy stream looks like a train
        // of pulses, a quiet one like a single wanderer.
        if (running && activity > 0) {
          let comet = 0;
          for (let c = 0; c < cometCount; c++) {
            const phase = ((c + 1) / (cometCount + 1)) * cols;
            const pos = (phase + tick * cometSpeed * cols) % (cols + 4) - 2;
            const d = Math.abs(x - pos);
            comet = Math.max(comet, Math.max(0, 1 - d / 1.5));
          }
          intensity = Math.max(intensity, comet * (0.4 + Math.min(activity, 1) * 0.6));
        }
      }

      // ── Bottom row(s): RAM fill ────────────────────────────────────────────
      else {
        if (x < ramEdge && running) {
          // Solid fill with a subtle shimmer; brighter near the leading edge so
          // the level reads like a fluid surface.
          const edgeBoost = x === ramEdge - 1 ? 0.25 : 0;
          const shimmer = (Math.sin(tick * 0.2 + x * 0.4) + 1) / 2;
          intensity = 0.5 + shimmer * 0.35 + edgeBoost;
          color = ram > 0.85 ? "amber" : "green";
        } else {
          // Past the fill level: faint grid track.
          intensity = 0.06;
          color = "gray";
        }
      }

      buffer.push({ intensity, color });
    }
  }

  return buffer;
};
