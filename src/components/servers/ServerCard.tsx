import type { CSSProperties } from "react";
import type { ServerInstance } from "../../types/server";
import { statusColor, statusHex } from "./status";

interface ServerCardProps {
  server: ServerInstance;
  onDelete: (id: string) => void;
  onEdit: (server: ServerInstance) => void;
  /** Navigate to the detail view for this instance. */
  onSelect?: (id: string) => void;
}

/** Number of dots in the status banner row. */
const BANNER_DOTS = 16;

/**
 * Per-status animation config for the dot banner.
 * Each emission-matrix axis gets a distinct kinetic signature.
 */
function getDotAnimation(color: string, _index: number): CSSProperties {
  switch (color) {
    case "green":
      // Traveling wave — we use index-based delay inline when rendering.
      return { animation: "dot-wave 2s ease-in-out infinite" };
    case "amber":
      // Slow breathe — all dots pulse together.
      return { animation: "dot-breathe 2.5s ease-in-out infinite" };
    case "crimson":
      // Rapid blink — fault attention.
      return { animation: "dot-blink 0.8s ease-in-out infinite" };
    default:
      // Stopped / gray — static, dim. No animation.
      return { opacity: 0.25 };
  }
}

/**
 * Compact registry card — redesigned as a unified "matrix node" panel.
 *
 * Key design decisions (see docs/design-notes.md §23):
 *  - The entire card is the click target (no separate "view" button).
 *  - A dot banner replaces the single status dot, using CSS-only animations
 *    keyed to the emission-matrix color axis (DesignGuide §2).
 *  - Edit/Delete are icon-only buttons with stopPropagation.
 *  - On hover, a dot-crawl affordance + status glow signal clickability.
 *  - Performance: zero rAF loops — all animations are GPU-composited CSS.
 */
export function ServerCard({ server, onDelete, onEdit, onSelect }: ServerCardProps) {
  const color = statusColor(server);
  const hex = statusHex(color);

  function handleSelect() {
    onSelect?.(server.id);
  }

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    onEdit(server);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete(server.id);
  }

  return (
    <div
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSelect();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${server.name}`}
      className="group relative border border-grid-bounds bg-bg-surface p-4 matrix-border
                 cursor-pointer transition-shadow duration-300
                 hover:shadow-[0_0_12px_var(--glow-color)]"
      style={{ "--glow-color": hex } as CSSProperties}
    >
      {/* ── Dot banner ───────────────────────────────────────────────────── */}
      <div className="flex gap-[3px] mb-4" aria-hidden="true">
        {Array.from({ length: BANNER_DOTS }).map((_, i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full"
            style={{
              backgroundColor: hex,
              ...getDotAnimation(color, i),
              animationDelay: color === "green" ? `${i * 0.07}s` : undefined,
            }}
          />
        ))}
      </div>

      {/* ── Header: server name + ID (display only) + inline actions ─────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm text-zinc-100 truncate group-hover:text-zinc-50 transition-colors">
            {server.name}
          </h2>
          <p className="text-[11px] text-zinc-500 font-mono truncate">
            {server.id}
          </p>
        </div>

        {/* Icon-only action buttons — stopPropagation keeps them from navigating. */}
        <div className="flex gap-1 shrink-0">
          <button
            onClick={handleEdit}
            className="px-1.5 py-1 text-[11px] leading-none text-zinc-500 border border-grid-bounds
                       hover:border-signal-low hover:text-zinc-200 transition-colors"
            aria-label={`Edit ${server.name}`}
          >
            ✎
          </button>
          <button
            onClick={handleDelete}
            className="px-1.5 py-1 text-[11px] leading-none text-zinc-500 border border-grid-bounds
                       hover:border-fault-vector hover:text-fault-vector transition-colors"
            aria-label={`Delete ${server.name}`}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Metadata definition list ─────────────────────────────────────── */}
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
        <dt className="text-zinc-600 uppercase tracking-wider">type</dt>
        <dd className="text-zinc-300 font-mono truncate">{server.serverType}</dd>

        <dt className="text-zinc-600 uppercase tracking-wider">status</dt>
        <dd className="font-mono" style={{ color: hex }}>
          {server.isOrphaned ? "orphaned" : server.status}
        </dd>

        <dt className="text-zinc-600 uppercase tracking-wider">path</dt>
        <dd className="text-zinc-400 font-mono truncate" title={server.path}>
          {server.path}
        </dd>

        {Object.keys(server.userOverrides).length > 0 && (
          <>
            <dt className="text-zinc-600 uppercase tracking-wider">overrides</dt>
            <dd className="text-zinc-400 font-mono truncate">
              {Object.entries(server.userOverrides)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ")}
            </dd>
          </>
        )}
      </dl>

      {/* ── Orphaned banner ─────────────────────────────────────────────── */}
      {server.isOrphaned && (
        <p className="mt-4 px-2 py-1 text-[11px] text-fault-vector border border-fault-vector/40 bg-fault-vector/5">
          ⚠ path inaccessible — instance marked orphaned
        </p>
      )}
    </div>
  );
}