import { useEffect, useRef, useState } from "react";
import type {
  DotColor,
  MatrixBuffer,
  MatrixShader,
  ShaderContext,
  ShaderTelemetry,
} from "../../types/matrix";

interface ViewportProps {
  cols: number;
  rows: number;
  shader: MatrixShader;
  telemetry: ShaderTelemetry;
  /** Optional className to control sizing/positioning of the wrapper. */
  className?: string;
}

/**
 * Color axis → emission-matrix hex token (DesignGuide §2).
 * Kept here so dots resolve to the exact palette regardless of Tailwind purge.
 */
const COLOR_HEX: Record<DotColor, string> = {
  green: "#4cf5a0",
  crimson: "#f54c4c",
  amber: "#f5a04c",
  gray: "#4c525e",
};

/**
 * Viewport canvas core.
 * Spec: documentation/DesignGuide.md §5.
 *
 * Renders an M × N grid of micro-nodes from the output of a mathematical
 * shader function, frame by frame via requestAnimationFrame.
 */
export function MatrixViewport({
  cols,
  rows,
  shader,
  telemetry,
  className,
}: ViewportProps) {
  const [buffer, setBuffer] = useState<MatrixBuffer>(() =>
    shader({ tick: 0, cols, rows, telemetry }),
  );
  // Refs let the rAF loop read the latest props without re-subscribing each
  // render — avoiding a stutter when telemetry updates every frame.
  const shaderRef = useRef(shader);
  const telemetryRef = useRef(telemetry);
  shaderRef.current = shader;
  telemetryRef.current = telemetry;

  useEffect(() => {
    let tick = 0;
    let frameId = 0;

    const renderLoop = () => {
      tick++;
      const context: ShaderContext = {
        tick,
        cols,
        rows,
        telemetry: telemetryRef.current,
      };
      setBuffer(shaderRef.current(context));
      frameId = requestAnimationFrame(renderLoop);
    };

    frameId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(frameId);
  }, [cols, rows]);

  return (
    <div
      className={`grid gap-[3px] bg-bg-core border border-grid-bounds p-1.5 ${className ?? ""}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {buffer.map((node, idx) => {
        const color = COLOR_HEX[node.color ?? "green"];
        return (
          <span
            key={idx}
            className="block w-1 h-1 rounded-full"
            style={{
              backgroundColor: color,
              opacity: node.intensity,
              boxShadow:
                node.intensity > 0.8 && node.color !== "gray"
                  ? `0 0 3px ${color}`
                  : "none",
              transition: "opacity 75ms linear",
            }}
          />
        );
      })}
    </div>
  );
}
