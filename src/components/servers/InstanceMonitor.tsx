/**
 * Instance monitor — a consolidated panel of per-instance tools:
 *   - Listening ports + quick-connect
 *   - Energy / cost estimate
 *   - Metrics history graph (CPU/RAM over the last 24h)
 *   - Backup schedule config
 *   - Health-alert thresholds config
 *   - Find & replace across files
 *
 * Rendered as the "monitor" built-in tab in ServerDetailView so all the
 * analytical/power features live in one place rather than cluttering the
 * terminal/files surface.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../../hooks/useToast";
import type {
  ListeningPort,
  MetricSample,
  EnergyCost,
  ReplaceResult,
} from "../../types/features";
import type { ServerInstance, BackupSchedule, AlertRules } from "../../types/server";

interface InstanceMonitorProps {
  server: ServerInstance;
  /** Whether the instance process is currently running (drives ports/metrics). */
  running: boolean;
}

export function InstanceMonitor({ server, running }: InstanceMonitorProps) {
  const { notify } = useToast();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl p-4 space-y-6">
        <PortsCard server={server} running={running} notify={notify} />
        <EnergyCard server={server} />
        <MetricsCard server={server} running={running} />
        <BackupCard server={server} notify={notify} />
        <AlertsCard server={server} />
        <FindReplaceCard server={server} notify={notify} />
      </div>
    </div>
  );
}

/* ── Card primitives ───────────────────────────────────────────────────── */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-grid-bounds">
      <div className="px-3 py-2 border-b border-grid-bounds">
        <h3 className="text-[10px] tracking-[0.2em] uppercase text-zinc-500">{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1 text-[11px]">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200 font-mono">{value}</span>
    </div>
  );
}

/* ── Ports ────────────────────────────────────────────────────────────── */

function PortsCard({
  server,
  running,
  notify,
}: {
  server: ServerInstance;
  running: boolean;
  notify: ReturnType<typeof useToast>["notify"];
}) {
  const [ports, setPorts] = useState<ListeningPort[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPorts(await invoke<ListeningPort[]>("get_instance_ports", { id: server.id }));
    } catch {
      setPorts([]);
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  useEffect(() => {
    if (running) void refresh();
    if (!running) setPorts([]);
  }, [running, refresh]);

  return (
    <Card title="ports & quick-connect">
      {!running && (
        <p className="text-[11px] text-zinc-600">start the instance to detect listening ports.</p>
      )}
      {running && loading && <p className="text-[11px] text-zinc-600">scanning…</p>}
      {running && !loading && ports.length === 0 && (
        <p className="text-[11px] text-zinc-600">no listening TCP ports detected.</p>
      )}
      {ports.map((p) => (
        <Row
          key={p.port}
          label={`:${p.port}`}
          value={
            <button
              onClick={() => {
                navigator.clipboard?.writeText(p.connect);
                notify({ kind: "info", title: "Copied", message: p.connect });
              }}
              className="text-signal-high hover:underline"
            >
              {p.connect} ⧉
            </button>
          }
        />
      ))}
    </Card>
  );
}

/* ── Energy ───────────────────────────────────────────────────────────── */

function EnergyCard({ server }: { server: ServerInstance }) {
  const [cost, setCost] = useState<EnergyCost | null>(null);

  useEffect(() => {
    invoke<EnergyCost>("get_instance_energy", { id: server.id })
      .then(setCost)
      .catch(() => setCost(null));
  }, [server.id]);

  if (!cost || cost.cost === 0) {
    return (
      <Card title="energy & cost">
        <p className="text-[11px] text-zinc-600">
          Set an electricity price in settings to see a running-cost estimate here.
        </p>
      </Card>
    );
  }

  return (
    <Card title="energy & cost">
      <Row label="running hours" value={`${cost.hours.toFixed(0)} h`} />
      <Row label="est. draw" value={`${cost.estWatts.toFixed(0)} W`} />
      <Row label="est. cost" value={cost.cost.toFixed(2)} />
    </Card>
  );
}

/* ── Metrics history graph ────────────────────────────────────────────── */

function MetricsCard({ server, running }: { server: ServerInstance; running: boolean }) {
  const [samples, setSamples] = useState<MetricSample[]>([]);
  const [windowH, setWindowH] = useState<24 | 168>(24);

  useEffect(() => {
    invoke<MetricSample[]>("get_metrics_history", {
      id: server.id,
      windowSecs: windowH * 3600,
    })
      .then(setSamples)
      .catch(() => setSamples([]));
  }, [server.id, windowH, running]);

  return (
    <Card title={`resource history · last ${windowH === 24 ? "24h" : "7d"}`}>
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setWindowH(24)}
          className={`text-[10px] px-2 py-1 border ${windowH === 24 ? "border-signal-high text-signal-high" : "border-grid-bounds text-zinc-500"}`}
        >
          24h
        </button>
        <button
          onClick={() => setWindowH(168)}
          className={`text-[10px] px-2 py-1 border ${windowH === 168 ? "border-signal-high text-signal-high" : "border-grid-bounds text-zinc-500"}`}
        >
          7d
        </button>
      </div>
      {samples.length === 0 ? (
        <p className="text-[11px] text-zinc-600">
          no history yet — samples accumulate while the instance runs.
        </p>
      ) : (
        <Sparkline samples={samples} />
      )}
    </Card>
  );
}

/** Tiny inline sparkline of CPU/RAM samples. */
function Sparkline({ samples }: { samples: MetricSample[] }) {
  if (samples.length < 2) {
    return <p className="text-[11px] text-zinc-600">collecting… ({samples.length} samples)</p>;
  }
  const w = 600;
  const h = 80;
  const step = w / (samples.length - 1);
  const cpuPts = samples.map((s, i) => `${i * step},${h - s.cpu * h}`).join(" ");
  const ramPts = samples.map((s, i) => `${i * step},${h - s.ram * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20 bg-bg-core border border-grid-bounds">
      <polyline points={cpuPts} fill="none" stroke="var(--color-signal-high, #4cf5a0)" strokeWidth="1" />
      <polyline points={ramPts} fill="none" stroke="var(--color-warn-vector, #f5a04c)" strokeWidth="1" />
    </svg>
  );
}

/* ── Backup schedule ──────────────────────────────────────────────────── */

function BackupCard({
  server,
  notify,
}: {
  server: ServerInstance;
  notify: ReturnType<typeof useToast>["notify"];
}) {
  const [sched, setSched] = useState<BackupSchedule>(
    server.backupSchedule ?? { intervalSecs: 0, keep: 12, onStop: false, lastBackupSecs: 0 },
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await invoke("update_backup_schedule", { id: server.id, schedule: sched });
      notify({ kind: "success", title: "Backup schedule saved" });
    } catch (e) {
      notify({ kind: "error", title: "Save failed", message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function snapshotNow() {
    setBusy(true);
    try {
      await invoke("backup_world", { id: server.id });
      notify({ kind: "success", title: "Snapshot created" });
    } catch (e) {
      notify({ kind: "error", title: "Snapshot failed", message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="backup schedule">
      <div className="space-y-2">
        <label className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">interval (hours, 0 = off)</span>
          <input
            type="number"
            min={0}
            value={Math.floor(sched.intervalSecs / 3600)}
            onChange={(e) => setSched({ ...sched, intervalSecs: (parseInt(e.target.value) || 0) * 3600 })}
            className="w-20 bg-bg-core border border-grid-bounds px-2 py-1 text-zinc-200"
          />
        </label>
        <label className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">keep last (snapshots)</span>
          <input
            type="number"
            min={1}
            value={sched.keep}
            onChange={(e) => setSched({ ...sched, keep: parseInt(e.target.value) || 12 })}
            className="w-20 bg-bg-core border border-grid-bounds px-2 py-1 text-zinc-200"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={sched.onStop}
            onChange={(e) => setSched({ ...sched, onStop: e.target.checked })}
            className="accent-signal-high"
          />
          <span>also snapshot when the server stops</span>
        </label>
        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={busy} className="btn-mono-primary">
            save schedule
          </button>
          <button onClick={snapshotNow} disabled={busy} className="btn-mono">
            snapshot now
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ── Alert thresholds ─────────────────────────────────────────────────── */

function AlertsCard({ server }: { server: ServerInstance }) {
  const [rules, setRules] = useState<AlertRules>(
    server.alertRules ?? { cpuThreshold: 0.9, ramThreshold: 0.9, sustainedSecs: 60 },
  );
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  async function save() {
    setBusy(true);
    try {
      await invoke("update_alert_rules", { id: server.id, rules });
      notify({ kind: "success", title: "Alert rules saved" });
    } catch (e) {
      notify({ kind: "error", title: "Save failed", message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="health alerts">
      <div className="space-y-2">
        <label className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">alert if CPU over (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={rules.cpuThreshold != null ? Math.round(rules.cpuThreshold * 100) : 0}
            onChange={(e) =>
              setRules({ ...rules, cpuThreshold: (parseInt(e.target.value) || 0) / 100 })
            }
            className="w-20 bg-bg-core border border-grid-bounds px-2 py-1 text-zinc-200"
          />
        </label>
        <label className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">alert if RAM over (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={rules.ramThreshold != null ? Math.round(rules.ramThreshold * 100) : 0}
            onChange={(e) =>
              setRules({ ...rules, ramThreshold: (parseInt(e.target.value) || 0) / 100 })
            }
            className="w-20 bg-bg-core border border-grid-bounds px-2 py-1 text-zinc-200"
          />
        </label>
        <label className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">sustained for (seconds)</span>
          <input
            type="number"
            min={1}
            value={rules.sustainedSecs}
            onChange={(e) => setRules({ ...rules, sustainedSecs: parseInt(e.target.value) || 60 })}
            className="w-20 bg-bg-core border border-grid-bounds px-2 py-1 text-zinc-200"
          />
        </label>
        <p className="text-[10px] text-zinc-600 pt-1">
          Alerts fire as a toast when a threshold is crossed for the sustained window.
        </p>
        <button onClick={save} disabled={busy} className="btn-mono-primary">
          save rules
        </button>
      </div>
    </Card>
  );
}

/* ── Find & replace across files ──────────────────────────────────────── */

function FindReplaceCard({
  server,
  notify,
}: {
  server: ServerInstance;
  notify: ReturnType<typeof useToast>["notify"];
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!find) return;
    setBusy(true);
    try {
      const res = await invoke<ReplaceResult>("find_replace_in_files", {
        id: server.id,
        query: find,
        replacement: replace,
        exclude: "node_modules/**,.git/**,target/**,backups/**",
      });
      notify({
        kind: res.filesChanged > 0 ? "success" : "info",
        title: res.filesChanged > 0 ? `Replaced in ${res.filesChanged} files` : "No matches",
        message: `${res.replacements} replacement${res.replacements !== 1 ? "s" : ""}`,
      });
    } catch (e) {
      notify({ kind: "error", title: "Replace failed", message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="find & replace across files">
      <div className="space-y-2">
        <input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="find"
          className="w-full bg-bg-core border border-grid-bounds px-2 py-1.5 text-xs text-zinc-100 font-mono"
        />
        <input
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          placeholder="replace with"
          className="w-full bg-bg-core border border-grid-bounds px-2 py-1.5 text-xs text-zinc-100 font-mono"
        />
        <p className="text-[10px] text-zinc-600">
          Case-sensitive. Excludes node_modules, .git, target, backups. Max 500 files, 1 MiB each.
        </p>
        <button onClick={run} disabled={busy || !find} className="btn-mono-primary">
          replace all
        </button>
      </div>
    </Card>
  );
}
