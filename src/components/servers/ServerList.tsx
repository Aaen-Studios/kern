import type { ServerInstance } from "../../types/server";
import { ServerCard } from "./ServerCard";
import { MatrixViewport } from "../matrix/MatrixViewport";
import { polarRadarShader } from "../matrix/shaders/polarRadar";

interface ServerListProps {
  servers: ServerInstance[];
  onDelete: (id: string) => void;
  onEdit: (server: ServerInstance) => void;
  onAdd: () => void;
}

/**
 * Overview of the registry. The empty state frames the radar viewport so the
 * host is never visually idle — the sweep pulses even with no instances.
 */
export function ServerList({ servers, onDelete, onEdit, onAdd }: ServerListProps) {
  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <MatrixViewport
          cols={9}
          rows={9}
          shader={polarRadarShader}
          telemetry={{ cpu: 0.12, ram: 0.2, status: "idle" }}
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
      <h2 className="mb-3 text-[10px] tracking-[0.2em] uppercase text-zinc-500">
        all instances
      </h2>
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}
