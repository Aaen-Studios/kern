/**
 * Mathematical shader engine — fluid vector arrays.
 * Spec: documentation/DesignGuide.md §3
 *
 * The viewport treats its surface as a flat data buffer of size S = cols × rows.
 * Each frame, every coordinate index is resolved into local 2D space and passed
 * through a pure mathematical shader function that returns the rendered state.
 */

/** Color tokens map 1:1 to the emission matrix palette (DesignGuide §2). */
export type DotColor = "green" | "crimson" | "amber" | "gray";

/** A single micro-node in the matrix. */
export interface DotNode {
  /** Normalized scalar floating-point value: 0.0 to 1.0 */
  intensity: number;
  /** Color axis; defaults to green when omitted. */
  color?: DotColor;
}

/** Flat array buffer of size cols × rows. */
export type MatrixBuffer = DotNode[];

/** Live telemetry fed into shaders by the host. */
export interface ShaderTelemetry {
  /** Live metric: 0.0 to 1.0+ */
  cpu: number;
  /** Live metric: 0.0 to 1.0+ */
  ram: number;
  /** Raw status string passed from the Tauri core. */
  status: string;
}

/** Runtime context handed to every shader invocation. */
export interface ShaderContext {
  /** Continuous integer tracking the frame index. */
  tick: number;
  /** Total column count, dynamically provided by the UI wrapper. */
  cols: number;
  /** Total row count, dynamically provided by the UI wrapper. */
  rows: number;
  telemetry: ShaderTelemetry;
}

/**
 * Shaders are pure mathematical functions returning a dynamic canvas state.
 * Implementations must not retain state between calls.
 */
export type MatrixShader = (ctx: ShaderContext) => MatrixBuffer;
