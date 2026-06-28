import type { ReactNode } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import type { ServerInstance } from "../../types/server";

interface AppShellProps {
  servers: ServerInstance[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
  showPlugins: boolean;
  onNavigatePlugins: () => void;
  children: ReactNode;
}

/**
 * Full-viewport application shell: custom title bar on top, registry sidebar
 * on the left, scrollable main content area on the right. Spacing follows the
 * 4px grid scale (DesignGuide §6.2).
 */
export function AppShell({
  servers,
  selectedId,
  loading,
  onSelect,
  onAdd,
  onRefresh,
  showPlugins,
  onNavigatePlugins,
  children,
}: AppShellProps) {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg-core">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          servers={servers}
          selectedId={selectedId}
          loading={loading}
          onSelect={onSelect}
          onAdd={onAdd}
          onRefresh={onRefresh}
          showPlugins={showPlugins}
          onNavigatePlugins={onNavigatePlugins}
        />
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">{children}</main>
      </div>
    </div>
  );
}
