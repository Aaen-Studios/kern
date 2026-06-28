import type { ServerInstance } from "../../types/server";
import { statusColor, statusHex } from "../servers/status";

interface SidebarProps {
  servers: ServerInstance[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
}

/**
 * Left navigation rail listing every tracked instance. Items use a status dot
 * on the emission-matrix color axis (green/amber/crimson/gray). The right edge
 * is a dotted matrix track rather than a solid divider (DesignGuide §6.1).
 */
export function Sidebar({
  servers,
  selectedId,
  loading,
  onSelect,
  onAdd,
  onRefresh,
}: SidebarProps) {
  return (
    <aside className="flex flex-col w-60 border-r border-grid-bounds matrix-border bg-bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-grid-bounds">
        <span className="text-[10px] tracking-[0.2em] uppercase text-zinc-500">
          registry
        </span>
        <div className="flex gap-1">
          <button
            onClick={onRefresh}
            title="Re-check orphaned status"
            className="px-1.5 py-0.5 text-[11px] text-zinc-400 border border-grid-bounds hover:border-signal-low hover:text-zinc-200 transition-colors"
          >
            ↻
          </button>
          <button
            onClick={onAdd}
            className="px-2 py-0.5 text-[11px] text-bg-core bg-signal-high hover:opacity-80 transition-opacity font-semibold"
          >
            + new
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {loading && (
          <p className="px-3 py-2 text-[11px] text-zinc-600">loading registry…</p>
        )}
        {!loading && servers.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-zinc-600">
            no instances registered
          </p>
        )}
        <ul>
          {servers.map((server) => {
            const isSelected = server.id === selectedId;
            const dot = statusHex(statusColor(server));
            return (
              <li key={server.id}>
                <button
                  onClick={() => onSelect(server.id)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left border-l-2 transition-colors ${
                    isSelected
                      ? "border-signal-high bg-bg-core"
                      : "border-transparent hover:bg-bg-core"
                  }`}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: dot,
                      boxShadow: `0 0 4px ${dot}`,
                    }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-zinc-200 truncate">
                      {server.name}
                    </span>
                    <span className="block text-[10px] text-zinc-600 truncate font-mono">
                      {server.serverType}
                    </span>
                  </span>
                  {server.isOrphaned && (
                    <span className="text-[9px] text-fault-vector uppercase tracking-wider">
                      orphan
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
