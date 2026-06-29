import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppShell } from "./components/layout/AppShell";
import { ServerList } from "./components/servers/ServerList";
import { ServerForm } from "./components/servers/ServerForm";
import { ServerDetailView } from "./components/servers/ServerDetailView";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { PluginManager } from "./components/plugins/PluginManager";
import { useServers } from "./hooks/useServers";
import { useLiveStatus } from "./hooks/useLiveStatus";
import type { NewServerInput, ServerInstance } from "./types/server";

type View =
  | { kind: "list" }
  | { kind: "detail" }
  | { kind: "create" }
  | { kind: "edit"; server: ServerInstance }
  | { kind: "plugins" };

/**
 * Root dashboard. Owns the active view (list / detail / create / edit) and
 * selection, delegates all persistence + process lifecycle to the Rust core.
 */
export default function App() {
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

  // Overlay live process status onto the persisted list. The sidebar + main
  // list read persisted status, which only refreshes on explicit reload() and
  // races the async status:<id> events — so without this overlay they'd sit on
  // "stopped" while a process is actually running. Live status wins except when
  // an instance is orphaned (a dead path can't hide behind stale "running").
  const ids = useMemo(() => servers.map((s) => s.id), [servers]);
  const { liveStatus } = useLiveStatus(ids);
  const serversLive = useMemo(
    () =>
      servers.map((s) =>
        s.isOrphaned || liveStatus[s.id] == null
          ? s
          : { ...s, status: liveStatus[s.id] },
      ),
    [servers, liveStatus],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });

  // Confirmation dialog state — tracks the instance id pending deletion.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDelete = useMemo(
    () => serversLive.find((s) => s.id === pendingDeleteId) ?? null,
    [serversLive, pendingDeleteId],
  );

  const selected = useMemo(
    () => serversLive.find((s) => s.id === selectedId) ?? null,
    [serversLive, selectedId],
  );

  function handleSelect(id: string) {
    if (selectedId === id && view.kind === "detail") {
      setSelectedId(null);
      setView({ kind: "list" });
    } else {
      setSelectedId(id);
      setView({ kind: "detail" });
    }
  }

  function handleEdit(server: ServerInstance) {
    setSelectedId(server.id);
    setView({ kind: "edit", server });
  }

  async function handleCreate(input: NewServerInput) {
    const created = await createServer(input);
    setSelectedId(created.id);
    setView({ kind: "detail" });
  }

  async function handleUpdate(input: NewServerInput) {
    if (!selected) return;
    await updateServer({
      ...selected,
      name: input.name,
      serverType: input.serverType,
      path: input.path,
      userOverrides: input.userOverrides,
    });
    setView({ kind: "detail" });
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
      } catch { /* best-effort: still remove the registry entry below */ }
    }
    setDeleteFolder(false);
    await deleteServer(id);
    if (selectedId === id) {
      setSelectedId(null);
      setView({ kind: "list" });
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

  return (
    <AppShell
      servers={serversLive}
      selectedId={selectedId}
      loading={loading}
      onSelect={handleSelect}
      onAdd={() => setView({ kind: "create" })}
      onHome={() => setView({ kind: "list" })}
      onRefresh={refreshOrphaned}
      showPlugins={view.kind === "plugins"}
      onNavigatePlugins={() => setView({ kind: "plugins" })}
    >
      <ErrorBoundary>
        {view.kind === "detail" && selected ? (
          /* Detail view: full-height flex column so the terminal fills the
             remaining viewport. Rendered as a direct child of <main> (which
             is now overflow-hidden flex flex-col) — no scroll wrapper, so
             the terminal owns all vertical scrolling. */
          <ServerDetailView
            key="detail"
            server={selected}
            onBack={() => setView({ kind: "list" })}
            onStatusChange={handleStatusChange}
          />
        ) : (
          /* All other views: wrapped in a scrollable container so they
             still scroll within the now non-scrolling <main>. */
          <div className="h-full overflow-y-auto">
            {error && (
              <p className="m-4 text-[11px] text-fault-vector border border-fault-vector/40 bg-fault-vector/5 px-2 py-1">
                {error}
              </p>
            )}

            {view.kind === "list" && (
              <ServerList
                key="list"
                servers={serversLive}
                onDelete={handleDelete}
                onEdit={handleEdit}
                onAdd={() => setView({ kind: "create" })}
                onSelect={handleSelect}
              />
            )}

            {view.kind === "create" && (
              <ServerForm key="create" onSubmit={handleCreate} onCancel={() => setView({ kind: "list" })} />
            )}

            {view.kind === "edit" && (
              <ServerForm
                key="edit"
                initial={view.server}
                onSubmit={handleUpdate}
                onCancel={() => setView({ kind: "detail" })}
              />
            )}

            {view.kind === "plugins" && (
              <PluginManager key="plugins" onBack={() => setView({ kind: "list" })} />
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
    </AppShell>
  );
}
