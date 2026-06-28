import type { ServerInstance } from "../../types/server";
import { statusColor, statusHex } from "./status";

interface ServerCardProps {
  server: ServerInstance;
  onDelete: (id: string) => void;
  onEdit: (server: ServerInstance) => void;
}

/**
 * Compact registry card: name, type, path, and a status readout color-coded
 * on the emission-matrix axis. Orphaned instances show a fault banner and the
 * absolute path so the user can locate or restore the missing folder.
 */
export function ServerCard({ server, onDelete, onEdit }: ServerCardProps) {
  const color = statusColor(server);
  const hex = statusHex(color);

  return (
    <div className="border border-grid-bounds bg-bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: hex, boxShadow: `0 0 6px ${hex}` }}
          />
          <div className="min-w-0">
            <h2 className="text-sm text-zinc-100 truncate">{server.name}</h2>
            <p className="text-[11px] text-zinc-500 font-mono truncate">
              {server.id}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onEdit(server)}
            className="px-2 py-1 text-[11px] text-zinc-400 border border-grid-bounds hover:border-signal-low hover:text-zinc-200 transition-colors"
          >
            edit
          </button>
          <button
            onClick={() => onDelete(server.id)}
            className="px-2 py-1 text-[11px] text-zinc-500 border border-grid-bounds hover:border-fault-vector hover:text-fault-vector transition-colors"
          >
            delete
          </button>
        </div>
      </div>

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

      {server.isOrphaned && (
        <p className="mt-4 px-2 py-1 text-[11px] text-fault-vector border border-fault-vector/40 bg-fault-vector/5">
          ⚠ path inaccessible — instance marked orphaned
        </p>
      )}
    </div>
  );
}
