import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Manifest } from "../types/manifest";

/**
 * Loads installed community plugins from the Rust core.
 *
 * Spec: ArchitecturePlan §3 — manifests live under
 * `<app_data>/plugins/<id>/manifest.json` and are discovered by scanning that
 * directory (manifest::discover on the Rust side).
 */
export function usePlugins() {
  const [plugins, setPlugins] = useState<Manifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<Manifest[]>("list_plugins");
      if (mountedRef.current) setPlugins(list);
    } catch (e) {
      if (mountedRef.current) setError(String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  /** Re-fetch the plugin list from the backend. Useful after install/uninstall. */
  const refresh = useCallback(() => {
    void load();
  }, [load]);

  /** Look up a plugin by id from the cached list. */
  function byId(id: string): Manifest | undefined {
    return plugins.find((p) => p.id === id);
  }

  return { plugins, loading, error, byId, refresh };
}
