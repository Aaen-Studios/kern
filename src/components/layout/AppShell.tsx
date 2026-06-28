import type { ReactNode } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import type { ServerInstance } from "../../types/server";

interface AppShellProps {
  servers: ServerInstance[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
  children: ReactNode;
}

/**
 * Full-viewport application shell: header on top, sidebar left, main content
 * area right. Spacing follows the 4px grid scale (DesignGuide §6.2).
 */
export function AppShell({
  servers,
  selectedId,
  loading,
  onSelect,
  onAdd,
  onRefresh,
  children,
}: AppShellProps) {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg-core">
      <Header instanceCount={servers.length} />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          servers={servers}
          selectedId={selectedId}
          loading={loading}
          onSelect={onSelect}
          onAdd={onAdd}
          onRefresh={onRefresh}
        />
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
