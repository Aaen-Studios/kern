import {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  type RefObject,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppShell } from "./components/layout/AppShell";
import { ServerList } from "./components/servers/ServerList";
import { ServerForm } from "./components/servers/ServerForm";
import { ServerDetailView } from "./components/servers/ServerDetailView";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { PluginManager } from "./components/plugins/PluginManager";
import { SettingsView } from "./components/settings/SettingsView";
import { useServers } from "./hooks/useServers";
import { useLiveStatus } from "./hooks/useLiveStatus";
import { UiStateProvider, useUiState } from "./hooks/useUiState";
import { SidebarItemRegistryProvider } from "./hooks/useSidebarItems";
import { ToastProvider, ToastViewport, useToast } from "./hooks/useToast";
import type { NewServerInput, ServerInstance, SortPref } from "./types/server";

type View =
  | { kind: "list" }
  | { kind: "detail" }
  | { kind: "create" }
  | { kind: "edit"; server: ServerInstance }
  | { kind: "plugins" }
  | { kind: "settings" };

/* ─── Instance sorting ─────────────────────────────────────────────────── */

/**
 * Fixed sort order for the status lifecycle axis, active states first.
 * Used for the "status" sort key so the order is semantically meaningful
 * (running → starting → stopping → installing → stopped → error) rather
 * than purely alphabetical.
 */
const STATUS_RANK: Record<ServerInstance["status"], number> = {
  running: 0,
  starting: 1,
  stopping: 2,
  installing: 3,
  stopped: 4,
  error: 5,
};

/** Sort a copy of the server array in place according to the given preference. */
function sortInstances(servers: ServerInstance[], pref: SortPref): ServerInstance[] {
  const dir = pref.direction === "desc" ? -1 : 1;
  return [...servers].sort((a, b) => {
    let cmp: number;
    switch (pref.key) {
      case "name":
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        break;
      case "serverType":
        cmp = a.serverType.localeCompare(b.serverType, undefined, {
          sensitivity: "base",
        });
        break;
      case "path":
        cmp = a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
        break;
      case "status":
        cmp = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        break;
    }
    return cmp * dir;
  });
}

/* ─── Bridge context for lifting selectedServerId up to the provider ───── */

const SelectedIdBridgeContext = createContext<RefObject<(id: string | null) => void>>({
  current: () => {},
});

/**
 * Root dashboard. Owns the active view (list / detail / create / edit) and
 * selection, delegates all persistence + process lifecycle to the Rust core.
 *
 * The outer `App` wraps everything in a `UiStateProvider` so that all child
 * components can read/write persisted UI state. The inner `AppInner` does
 * the actual work, using `useUiState()` to restore + persist view state.
 */
export default function App() {
  // selectedServerId lives in AppInner but must be passed to UiStateProvider.
  // We lift it via local state + a bridge context so the provider always
  // sees the current selection without re-rendering the whole tree.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const onChangeRef = useRef(setSelectedId);
  onChangeRef.current = setSelectedId;

  return (
    <ToastProvider>
      <UiStateProvider selectedServerId={selectedId}>
        <SelectedIdBridgeContext.Provider value={onChangeRef}>
          <SidebarItemRegistryProvider>
            <AppInner />
          </SidebarItemRegistryProvider>
        </SelectedIdBridgeContext.Provider>
      </UiStateProvider>
    </ToastProvider>
  );
}

/**
 * Inner app component — owns all the real logic. Reads persisted UI state
 * from the context and syncs view/selection changes back to it.
 */
function AppInner() {
  const {
    servers,
    loading,
    error,
    createServer,
    updateServer,
    deleteServer,
    refreshOrphaned,
    reload,
  } = useServers();
  const { uiState, setView, setSortPreference } = useUiState();
  const bridgeRef = useContext(SelectedIdBridgeContext);
  const { notify } = useToast();

  // Bridge the servers-list hook's local error into the global toast channel
  // so it persists across navigation instead of vanishing on view change.
  // Tracked by value so a repeated identical error still re-notifies.
  useEffect(() => {
    if (error) {
      notify({ kind: "error", title: "Servers error", message: error });
    }
  }, [error, notify]);

  // Deep link state - .kern file path received via kern:// protocol or
  // .kern file-association double-click. The Rust backend resolves the
  // URL to a local file path before emitting this event.
  const [deepLinkedKernPath, setDeepLinkedKernPath] = useState<string | null>(null);

  // Listen for deep link events from Rust backend
  useEffect(() => {
    const unlisten = listen<string>("kern://open-install", (event) => {
      const path = event.payload;
      if (path) {
        setDeepLinkedKernPath(path);
        setViewLocal({ kind: "plugins" });
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // Tray → frontend: clicking a server in the tray menu shows the window and
  // asks us to focus that server's detail view. Payload is the server id.
  useEffect(() => {
    const unlisten = listen<string>("kern://focus-server", (event) => {
      const id = event.payload;
      if (servers.some((s) => s.id === id)) {
        handleSelect(id);
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers]);

  // Overlay live process status onto the persisted list. The sidebar + main
  // list read persisted status, which only refreshes on explicit reload() and
  // races the async status:<id> events — so without this overlay they'd sit on
  // "stopped" while a process is actually running. Live status wins except when
  // an instance is orphaned (a dead path can't hide behind stale "running").
  const ids = useMemo(() => servers.map((s) => s.id), [servers]);
  const { liveStatus, liveAdopted } = useLiveStatus(ids);
  const serversLive = useMemo(
    () =>
      servers.map((s) =>
        s.isOrphaned || liveStatus[s.id] == null
          ? s
          : { ...s, status: liveStatus[s.id] },
      ),
    [servers, liveStatus],
  );

  // Local view state — initialized from persisted state once servers load.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setViewLocal] = useState<View>({ kind: "list" });
  const [restored, setRestored] = useState(false);

  // Global event listeners: health alerts + backup completions from the
  // background scheduler → surface as toasts so they persist across navigation.
  useEffect(() => {
    let unlistenAlert: (() => void) | undefined;
    let unlistenBackup: (() => void) | undefined;
    (async () => {
      unlistenAlert = await listen<{
        id: string; name: string; metric: string; value: number; threshold: number;
      }>("kern://health-alert", (e) => {
        const { name, metric, value, threshold } = e.payload;
        notify({
          kind: "warn",
          title: `${name} — ${metric} high`,
          message: `${Math.round(value * 100)}% (over ${Math.round(threshold * 100)}% threshold)`,
        });
      });
      unlistenBackup = await listen<{ id: string; at: number }>("kern://backup-completed", (e) => {
        const server = serversLive.find((s) => s.id === e.payload.id);
        notify({
          kind: "success",
          title: "Backup saved",
          message: server?.name ?? e.payload.id,
        });
      });
    })();
    return () => {
      unlistenAlert?.();
      unlistenBackup?.();
    };
  }, [notify, serversLive]);

  // Restore persisted view/selection once servers are loaded.
  useEffect(() => {
    if (loading || restored) return;
    const savedView = uiState.activeViewKind;
    const savedSelected = uiState.selectedServerId;
    // Only restore "detail" if the selected server still exists.
    if (
      savedView === "detail" &&
      savedSelected &&
      servers.some((s) => s.id === savedSelected)
    ) {
      setSelectedId(savedSelected);
      setViewLocal({ kind: "detail" });
    } else if (savedView === "plugins") {
      setViewLocal({ kind: "plugins" });
    } else if (savedView === "settings") {
      setViewLocal({ kind: "settings" });
    } else {
      setViewLocal({ kind: "list" });
    }
    setRestored(true);
  }, [loading, restored, uiState.activeViewKind, uiState.selectedServerId, servers]);

  // Bridge selectedId changes up to the provider.
  useEffect(() => {
    bridgeRef.current(selectedId);
  }, [selectedId, bridgeRef]);

  // Persist view/selection changes.
  const persistView = useCallback(
    (kind: View["kind"], id: string | null) => {
      setView(kind, id);
    },
    [setView],
  );

  // Apply the user's sort preference. Doing this here, before the array splits
  // to the sidebar (via AppShell) and the main grid (via ServerList), means a
  // single sort preference controls instance order everywhere — no sync needed.
  const serversSorted = useMemo(
    () => (serversLive.length === 0 ? serversLive : sortInstances(serversLive, uiState.sortPreference)),
    [serversLive, uiState.sortPreference],
  );

  const selected = useMemo(
    () => serversSorted.find((s) => s.id === selectedId) ?? null,
    [serversSorted, selectedId],
  );

  // Confirmation dialog state — tracks the instance id pending deletion.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDelete = useMemo(
    () => serversLive.find((s) => s.id === pendingDeleteId) ?? null,
    [serversLive, pendingDeleteId],
  );

  function handleSelect(id: string) {
    if (selectedId === id && view.kind === "detail") {
      setSelectedId(null);
      setViewLocal({ kind: "list" });
      persistView("list", null);
    } else {
      setSelectedId(id);
      setViewLocal({ kind: "detail" });
      persistView("detail", id);
    }
  }

  function handleEdit(server: ServerInstance) {
    setSelectedId(server.id);
    setViewLocal({ kind: "edit", server });
    persistView("edit", server.id);
  }

  async function handleCreate(input: NewServerInput) {
    const created = await createServer(input);
    setSelectedId(created.id);
    setViewLocal({ kind: "detail" });
    persistView("detail", created.id);
  }

  async function handleUpdate(input: NewServerInput) {
    if (!selected) return;
    await updateServer({
      ...selected,
      name: input.name,
      serverType: input.serverType,
      path: input.path,
      userOverrides: input.userOverrides,
      autoStart: input.autoStart,
    });
    setViewLocal({ kind: "detail" });
    persistView("detail", selected.id);
  }

  /** Opens the confirmation dialog instead of deleting immediately. */
  function handleDelete(id: string) {
    setPendingDeleteId(id);
  }

  /** Whether the user opted to also delete the instance's working directory. */
  const [deleteFolder, setDeleteFolder] = useState(false);

  /** Persists the confirmed deletion and falls back to the list view. */
  async function confirmDelete() {
    const id = pendingDeleteId;
    if (!id) return;
    setPendingDeleteId(null);
    // If the user checked the option, wipe the working directory from disk
    // first — then remove the registry entry regardless.
    if (deleteFolder) {
      try {
        await invoke("delete_server_folder", { id });
      } catch {
        /* best-effort: still remove the registry entry below */
      }
    }
    setDeleteFolder(false);
    await deleteServer(id);
    if (selectedId === id) {
      setSelectedId(null);
      setViewLocal({ kind: "list" });
      persistView("list", null);
    }
  }

  function cancelDelete() {
    setPendingDeleteId(null);
  }

  // After a launch/stop, the persisted status changed — reload the registry so
  // the sidebar + cards reflect it, then keep the detail view open.
  function handleStatusChange() {
    void reload();
  }

  // Helper to set view + persist in one call.
  const navigate = useCallback(
    (kind: View["kind"]) => {
      setViewLocal({ kind } as View);
      persistView(kind, selectedId);
    },
    [persistView, selectedId],
  );

  return (
    <>
    <AppShell
      servers={serversSorted}
      selectedId={selectedId}
      loading={loading}
      onSelect={handleSelect}
      onAdd={() => navigate("create")}
      onHome={() => navigate("list")}
      onRefresh={refreshOrphaned}
      showPlugins={view.kind === "plugins"}
      onNavigatePlugins={() => navigate("plugins")}
      showSettings={view.kind === "settings"}
      onNavigateSettings={() => navigate("settings")}
    >
      <ErrorBoundary>
        {view.kind === "detail" && selected ? (
          /* Detail view: full-height flex column so the terminal fills the
             remaining viewport. Rendered as a direct child of <main> (which
             is now overflow-hidden flex flex-col) — no scroll wrapper, so
             the terminal owns all vertical scrolling. */
          <ServerDetailView
            key={selected.id}
            server={selected}
            adopted={liveAdopted.has(selected.id)}
            onBack={() => navigate("list")}
            onStatusChange={handleStatusChange}
          />
        ) : (
          /* All other views: wrapped in a scrollable container so they
             still scroll within the now non-scrolling <main>. */
          <div className="h-full overflow-y-auto">
            {view.kind === "list" && (
              <ServerList
                key="list"
                servers={serversSorted}
                onDelete={handleDelete}
                onEdit={handleEdit}
                onAdd={() => navigate("create")}
                onSelect={handleSelect}
                sortPreference={uiState.sortPreference}
                onSortChange={setSortPreference}
              />
            )}

            {view.kind === "create" && (
              <ServerForm
                key="create"
                onSubmit={handleCreate}
                onCancel={() => navigate("list")}
              />
            )}

            {view.kind === "edit" && (
              <ServerForm
                key="edit"
                initial={view.server}
                onSubmit={handleUpdate}
                onCancel={() => navigate("detail")}
              />
            )}

            {view.kind === "plugins" && (
              <PluginManager
                key="plugins"
                onBack={() => navigate("list")}
                preselectedKernPath={deepLinkedKernPath}
              />
            )}

            {view.kind === "settings" && (
              <SettingsView key="settings" onBack={() => navigate("list")} />
            )}
          </div>
        )}
      </ErrorBoundary>

      {/* Confirmation dialog for server deletion */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="delete instance"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" (${pendingDelete.id}) will be permanently removed from the registry.`
            : ""
        }
        optionalActionLabel="also delete the working directory on disk"
        onOptionalAction={(checked) => setDeleteFolder(checked)}
        confirmLabel="delete"
        cancelLabel="cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
      {/* Global toast stack — fixed top-right, overlays all views, persists
          across navigation and survives view crashes (lives outside the
          ErrorBoundary that wraps the main view). */}
      <ToastViewport />
    </AppShell>
    </>
  );
}
