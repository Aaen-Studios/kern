import type { ServerInstance } from "../../types/server";
import { ServerCard } from "./ServerCard";
import { MatrixViewport } from "../matrix/MatrixViewport";
import { polarRadarShader } from "../matrix/shaders/polarRadar";
import type { DotColor } from "../../types/matrix";

interface ServerListProps {
  servers: ServerInstance[];
  onDelete: (id: string) => void;
  onEdit: (server: ServerInstance) => void;
  /** Navigate to the detail view for a server. */
  onSelect?: (id: string) => void;
  onAdd: () => void;
}

/** Color swatches for the status-axis legend, mirroring status.ts. */
const LEGEND: { color: DotColor; label: string }[] = [
  { color: "green", label: "running" },
  { color: "amber", label: "transition / warn" },
  { color: "crimson", label: "orphaned / fault" },
  { color: "gray", label: "stopped" },
];

const DOT_HEX: Record<DotColor, string> = {
  green: "#4cf5a0",
  amber: "#f5a04c",
  crimson: "#f54c4c",
  gray: "#4c525e",
};

/**
 * Overview of the registry. The empty state frames the radar viewport so the
 * host is never visually idle — the sweep pulses even with no instances.
 */
export function ServerList({ servers, onDelete, onEdit, onAdd, onSelect }: ServerListProps) {
  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <MatrixViewport
          cols={11}
          rows={11}
          shader={polarRadarShader}
          telemetry={{ cpu: 0.1, ram: 0.18, status: "idle" }}
        />
        <div className="text-center">
          <p className="text-sm text-zinc-300">no server instances registered</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            register an instance to begin tracking its lifecycle
          </p>
          <button
            onClick={onAdd}
            className="mt-4 px-3 py-1.5 text-xs text-bg-core bg-signal-high hover:opacity-80 font-semibold transition-opacity"
          >
            + register instance
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] tracking-[0.2em] uppercase text-zinc-500">
          all instances{" "}
          <span className="text-zinc-600 tabular-nums">({servers.length})</span>
        </h2>
        <ul className="flex items-center gap-3">
          {LEGEND.map((entry) => (
            <li key={entry.color} className="flex items-center gap-1">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: DOT_HEX[entry.color] }}
              />
              <span className="text-[10px] text-zinc-600">{entry.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            onDelete={onDelete}
            onEdit={onEdit}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
