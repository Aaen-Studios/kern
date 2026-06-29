import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { ServerStatus } from "../types/server";

/**
 * Global live-status overlay.
 *
 * Problem this solves: the sidebar and main list read `server.status` from the
 * persisted config document, which is only refreshed on explicit `reload()`.
 * Process state changes fire asynchronously (`status:<id>` events) and the
 * persisted write races the reload — so the sidebar got stuck showing "stopped"
 * while a process was actually running, and only corrected on exit.
 *
 * Fix: subscribe once (at the app root) to the wildcard-ish `status:<id>`
 * channel for every instance id, hold a live status map, and persist the new
 * status so the next cold load is correct. Components merge this map over the
 * persisted list: live status wins when present.
 *
 * Mirrors StatusPayload in src-tauri/src/process.rs.
 */
type StatusPayload =
  | { state: "running" }
  | { state: "exited"; code: number | null };

/** Map of instanceId → live status. */
export type LiveStatusMap = Record<string, ServerStatus>;

/** Wildcard pattern prefix used for status events. */
const STATUS_EVENT_PREFIX = "status:";

interface UseLiveStatusResult {
  /** Live status per instance id, overlaid on persisted status. */
  liveStatus: LiveStatusMap;
}

/**
 * Subscribes to `status:<id>` events for every id in `ids` and returns a live
 * status map. Also persists transitions so a restart of the app reflects the
 * last known state. Meant to be mounted once at the app root.
 */
export function useLiveStatus(ids: string[]): UseLiveStatusResult {
  const [liveStatus, setLiveStatus] = useState<LiveStatusMap>({});

  useEffect(() => {
    if (ids.length === 0) return;
    let disposed = false;
    const unlistens: UnlistenFn[] = [];

    (async () => {
      for (const id of ids) {
        try {
          // Seed from the actual process registry: if a process is already
          // running when the app (re)opens — e.g. after a crash/restart while
          // the persisted doc still says "stopped" — correct the overlay now
          // rather than waiting for the next status event.
          try {
            const isRunning = await invoke<boolean>("is_server_running", { id });
            if (isRunning) setLiveStatus((prev) => ({ ...prev, [id]: "running" }));
          } catch { /* non-fatal seed */ }

          const un = await listen<StatusPayload>(`${STATUS_EVENT_PREFIX}${id}`, (event) => {
            if (disposed) return;
            const payload = event.payload;
            if (payload.state === "running") {
              setLiveStatus((prev) => ({ ...prev, [id]: "running" }));
              void invoke("update_server_status", { id, status: "running" });
            } else {
              // exited — map exit code to stopped/error and persist.
              const next: ServerStatus = payload.code != null && payload.code !== 0 ? "error" : "stopped";
              setLiveStatus((prev) => ({ ...prev, [id]: next }));
              void invoke("update_server_status", { id, status: next });
            }
          });
          if (disposed) {
            un();
            return;
          }
          unlistens.push(un);
        } catch {
          // Subscription failure is non-fatal — persisted status still loads.
        }
      }
    })();

    return () => {
      disposed = true;
      unlistens.forEach((un) => un());
    };
  }, [ids.join(",")]); // re-subscribe when the set of ids changes

  return { liveStatus };
}
