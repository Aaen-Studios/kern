import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NewServerInput, ServerInstance } from "../types/server";

/** Rust command names exposed by src-tauri/src/commands.rs. */
const CMD = {
  list: "get_servers",
  create: "create_server",
  update: "update_server",
  remove: "delete_server",
  refreshOrphaned: "refresh_orphaned_status",
} as const;

interface UseServersResult {
  servers: ServerInstance[];
  loading: boolean;
  error: string | null;
  createServer: (input: NewServerInput) => Promise<ServerInstance>;
  updateServer: (server: ServerInstance) => Promise<ServerInstance>;
  deleteServer: (id: string) => Promise<void>;
  refreshOrphaned: () => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Loads the server registry from the Rust core and exposes CRUD helpers.
 *
 * On mount it fetches the current list (which also recomputes orphaned status
 * server-side — ArchitecturePlan §2). All mutations optimistically re-fetch
 * the list so the UI always reflects the persisted document.
 */
export function useServers(): UseServersResult {
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<ServerInstance[]>(CMD.list);
      setServers(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createServer = useCallback(async (input: NewServerInput) => {
    const created = await invoke<ServerInstance>(CMD.create, { input });
    await reload();
    return created;
  }, [reload]);

  const updateServer = useCallback(async (server: ServerInstance) => {
    const updated = await invoke<ServerInstance>(CMD.update, { server });
    await reload();
    return updated;
  }, [reload]);

  const deleteServer = useCallback(async (id: string) => {
    await invoke<void>(CMD.remove, { id });
    await reload();
  }, [reload]);

  const refreshOrphaned = useCallback(async () => {
    await invoke<void>(CMD.refreshOrphaned);
    await reload();
  }, [reload]);

  return {
    servers,
    loading,
    error,
    createServer,
    updateServer,
    deleteServer,
    refreshOrphaned,
    reload,
  };
}
