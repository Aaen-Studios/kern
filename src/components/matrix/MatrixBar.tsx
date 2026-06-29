import { useEffect, useRef, useState } from "react";
import type { MatrixShader, ShaderTelemetry } from "../../types/matrix";
import { MatrixViewport } from "./MatrixViewport";

interface MatrixBarProps {
  /** Shader driving the bar. Should target a wide, short grid. */
  shader: MatrixShader;
  /** Live telemetry fed into the shader every frame. */
  telemetry: ShaderTelemetry;
  /** Row count (height). The reactor channel reads best at 3. Defaults to 3. */
  rows?: number;
  /** Target pixel pitch per column (dot + gap). Lower = denser. Default 7. */
  pitchPx?: number;
  /** Optional className for the fluid wrapper. */
  className?: string;
  /** Min/max column count so extreme widths still render sanely. */
  minCols?: number;
  maxCols?: number;
}

/**
 * Fluid-width matrix strip. Unlike the fixed-size `MatrixViewport`, this wraps a
 * `ResizeObserver` around its container and derives the column count from the
 * available width + dot pitch — so a single bar fills whatever horizontal space
 * its layout grants it, and re-flows on resize.
 *
 * Delegates the actual dot rendering to `MatrixViewport` (reusing its rAF loop,
 * throttling, and palette), only swapping in a computed `cols`.
 */
export function MatrixBar({
  shader,
  telemetry,
  rows = 3,
  pitchPx = 7,
  className,
  minCols = 12,
  maxCols = 96,
}: MatrixBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(minCols);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Measure once on attach so the first paint isn't stuck at minCols.
    const compute = () => {
      const width = el.clientWidth;
      const next = Math.max(minCols, Math.min(maxCols, Math.floor(width / pitchPx)));
      setCols(next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pitchPx, minCols, maxCols]);

  return (
    <div ref={containerRef} className={className} style={{ width: "100%" }}>
      <MatrixViewport
        cols={cols}
        rows={rows}
        shader={shader}
        telemetry={telemetry}
        throttleMs={60}
        fluid
      />
    </div>
  );
}
