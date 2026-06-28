import { useMemo, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { ServerList } from "./components/servers/ServerList";
import { ServerForm } from "./components/servers/ServerForm";
import { useServers } from "./hooks/useServers";
import type { NewServerInput, ServerInstance } from "./types/server";

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; server: ServerInstance };

/**
 * Root dashboard. Owns the active view (list / create / edit) and selection,
 * delegates all persistence to the useServers hook + Rust core.
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
  } = useServers();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });

  const selected = useMemo(
    () => servers.find((s) => s.id === selectedId) ?? null,
    [servers, selectedId],
  );

  function handleSelect(id: string) {
    setSelectedId(id);
    setView({ kind: "list" });
  }

  function handleEdit(server: ServerInstance) {
    setSelectedId(server.id);
    setView({ kind: "edit", server });
  }

  async function handleCreate(input: NewServerInput) {
    await createServer(input);
    setView({ kind: "list" });
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
    setView({ kind: "list" });
  }

  async function handleDelete(id: string) {
    await deleteServer(id);
    if (selectedId === id) setSelectedId(null);
    setView({ kind: "list" });
  }

  return (
    <AppShell
      servers={servers}
      selectedId={selectedId}
      loading={loading}
      onSelect={handleSelect}
      onAdd={() => setView({ kind: "create" })}
      onRefresh={refreshOrphaned}
    >
      {error && (
        <p className="m-4 text-[11px] text-fault-vector border border-fault-vector/40 bg-fault-vector/5 px-2 py-1">
          {error}
        </p>
      )}

      {view.kind === "list" && (
        <ServerList
          servers={servers}
          onDelete={handleDelete}
          onEdit={handleEdit}
          onAdd={() => setView({ kind: "create" })}
        />
      )}

      {view.kind === "create" && (
        <ServerForm onSubmit={handleCreate} onCancel={() => setView({ kind: "list" })} />
      )}

      {view.kind === "edit" && (
        <ServerForm
          initial={view.server}
          onSubmit={handleUpdate}
          onCancel={() => setView({ kind: "list" })}
        />
      )}
    </AppShell>
  );
}
