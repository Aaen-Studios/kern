import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Process lifecycle + live log streaming for a single server instance.
 *
 * Spec: ArchitecturePlan §5 (Phase 2) — the Rust core streams stdout/stderr
 * line-by-line over a `log:<id>:stream` event and emits a structured
 * `StatusPayload` over `status:<id>` on state transitions. This hook seeds the
 * buffer from `get_log_tail`, then appends each streamed line as it arrives.
 *
 * Phase 4 extension: supports install, restart, and arbitrary lifecycle steps.
 * When a process exits, persisted status is synced to "stopped" or "error"
 * depending on the exit code.
 */

/** Mirrors StatusPayload in src-tauri/src/process.rs. */
type StatusPayload =
  | { state: "running" }
  | { state: "exited"; code: number | null };

/** Max lines held in memory before older entries are trimmed. */
const MAX_LINES = 2000;

/**
 * Monotonically increasing subscription generation. Bumped every time the
 * log/status subscription effect (re)starts; each callback captures the value
 * at attach time and no-ops if a newer generation has since taken over. This
 * prevents double-rendering when the effect fires twice before the first async
 * `listen` resolves (React StrictMode, fast remounts, page refresh).
 */
let subscriptionGen = 0;

/** Formats the current wall-clock time as `[HH:MM:SS]` — mirrors the Rust backend's `process::timestamp()`. */
function timestamp(): string {
  const now = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return `[${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}]`;
}

interface UseServerControlResult {
  logs: string[];
  running: boolean;
  launching: boolean;
  /** True while a non-start lifecycle step (install, build, etc.) is running. */
  busy: boolean;
  /** Launch the instance's start lifecycle step. */
  launch: () => Promise<void>;
  /** Terminate the instance. Idempotent. */
  stop: () => Promise<void>;
  /** Run the "install" lifecycle step (e.g. npm install, cargo build). */
  install: () => Promise<void>;
  /** Restart a running instance (stop then start). */
  restart: () => Promise<void>;
  /** Run an arbitrary lifecycle step by name. */
  runStep: (stepName: string) => Promise<void>;
  /** Append a line directly to the local log buffer (for local echo, etc.). */
  pushLine: (line: string) => void;
  error: string | null;
}

export function useServerControl(
  serverId: string | null,
  onChange?: () => void,
): UseServerControlResult {
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [busy, setBusy] = useState(false); // non-start step in progress
  const [error, setError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Seed the log buffer + running state whenever the selected server changes.
  useEffect(() => {
    let cancelled = false;
    setLogs([]);
    setError(null);
    if (!serverId) {
      setRunning(false);
      return;
    }
    (async () => {
      try {
        const [tail, isRunning] = await Promise.all([
          invoke<string[]>("get_log_tail", { id: serverId, maxLines: 500 }),
          invoke<boolean>("is_server_running", { id: serverId }),
        ]);
        if (cancelled) return;
        setLogs(tail);
        setRunning(isRunning);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverId]);

  // Subscribe to the live log + status streams for this instance.
  //
  // Generation guard: this effect spins up an async IIFE that awaits the two
  // `listen` calls. Under React StrictMode (and on fast remounts / page
  // refresh), the effect can run twice before the first IIFE resolves — which
  // would attach two live listeners and render every streamed line twice. We
  // bump a generation counter on each (re)entry and capture it in a ref; each
  // callback checks the ref and no-ops if a newer subscription has since taken
  // over. The cleanup then unsubscribes whichever listener actually landed.
  useEffect(() => {
    if (!serverId) return;
    const gen = ++subscriptionGen;
    let unlistenLog: UnlistenFn | undefined;
    let unlistenStatus: UnlistenFn | undefined;

    (async () => {
      unlistenLog = await listen<string>(`log:${serverId}:stream`, (event) => {
        // Ignore events from a subscription a newer effect cycle has superseded.
        if (subscriptionGen !== gen) return;
        setLogs((prev) => {
          const next = [...prev, event.payload];
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      });
      unlistenStatus = await listen<StatusPayload>(`status:${serverId}`, (event) => {
        if (subscriptionGen !== gen) return;
        const payload = event.payload;
        if (payload.state === "running") {
          setRunning(true);
          setBusy(false);
        } else {
          // exited — sync persisted status so the sidebar matches reality.
          setRunning(false);
          setBusy(false);
          const newStatus = payload.code != null && payload.code !== 0 ? "error" : "stopped";
          void invoke("update_server_status", { id: serverId, status: newStatus });
        }
        onChangeRef.current?.();
      });
    })();

    return () => {
      unlistenLog?.();
      unlistenStatus?.();
    };
  }, [serverId]);

  const launch = useCallback(async () => {
    if (!serverId || launching) return;
    setLaunching(true);
    setError(null);
    try {
      await invoke("launch_server_instance", { id: serverId });
      setRunning(true);
      onChangeRef.current?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  }, [serverId, launching]);

  const stop = useCallback(async () => {
    if (!serverId) return;
    setError(null);
    try {
      await invoke("stop_server_instance", { id: serverId });
      setRunning(false);
      onChangeRef.current?.();
    } catch (e) {
      setError(String(e));
    }
  }, [serverId]);

  const install = useCallback(async () => {
    if (!serverId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("install_server_instance", { id: serverId });
      onChangeRef.current?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [serverId, busy]);

  const restart = useCallback(async () => {
    if (!serverId || launching) return;
    setLaunching(true);
    setError(null);
    try {
      await invoke("restart_server_instance", { id: serverId });
      setRunning(true);
      onChangeRef.current?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  }, [serverId, launching]);

  const runStep = useCallback(async (stepName: string) => {
    if (!serverId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("run_lifecycle_step", { id: serverId, stepName });
      onChangeRef.current?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [serverId, busy]);

  // Append a line directly to the local log buffer without going through the
  // streaming event — used to echo user-typed commands back into the terminal.
  // Prefixed with a timestamp so local-echo lines match streamed ones.
  const pushLine = useCallback((line: string) => {
    setLogs((prev) =>
      prev.length >= MAX_LINES
        ? [...prev.slice(1), `${timestamp()} ${line}`]
        : [...prev, `${timestamp()} ${line}`],
    );
  }, []);

  return { logs, running, launching, busy, launch, stop, install, restart, runStep, pushLine, error };
}
