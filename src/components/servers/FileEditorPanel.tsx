/**
 * File Editor Panel — the full VS Code-like editing experience within the
 * server detail view.
 *
 * Assembles:
 *   - File tree sidebar (left, 220px)
 *   - Editor area (right): tab bar + Monaco editor + status bar
 *   - Error/save-state banners
 *
 * Each `FileEditorPanel` owns an independent editor session via `useFileEditor`.
 * Editor state (open files, expanded tree paths, cursor position) is persisted
 * per-server via `useUiState` and restored on mount.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { FileTree } from "./FileTree";
import { EditorTabBar } from "./EditorTabBar";
import { CodeEditor, configureMonaco, editorFocus } from "./CodeEditor";
import { useFileEditor } from "../../hooks/useFileEditor";
import { FileSearchPanel } from "./FileSearchPanel";
import { useUiState } from "../../hooks/useUiState";
import { ConfirmDialog } from "../ui/ConfirmDialog";

interface FileEditorPanelProps {
  /** Server instance id — scopes all file operations. */
  serverId: string;
}

// Ensure Monaco theme is registered at least once at module level.
configureMonaco();

export function FileEditorPanel({ serverId }: FileEditorPanelProps) {
  const {
    // State
    openFiles,
    activeFile,
    busy,
    error,
    dirtyCount,
    tabs,
    activeFileData,
    // Actions
    openFile,
    closeFile,
    setActiveFile,
    saveFile,
    saveAllFiles,
    setFileContent,
    clearError,
    listDirectory,
    deletePath,
    createFile,
    createDirectory,
    renamePath,
  } = useFileEditor(serverId);

  const { uiState, updateServer } = useUiState();

  // ── Persisted per-server editor state ─────────────────────────────────
  const serverUi = uiState.servers[serverId] ?? {
    activeTab: "logs" as const,
    pluginExpanded: true,
    commandHistory: [],
    editor: { openFiles: [], activeFile: null, expandedPaths: [], cursorLine: 1, cursorCol: 1 },
  };
  const editorUi = serverUi.editor;

  // Expanded directory paths in the file tree — initialized from persisted state.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(editorUi.expandedPaths),
  );
  const [refreshTree, setRefreshTree] = useState(0);
  const [cursorLine, setCursorLine] = useState(editorUi.cursorLine);
  const [cursorCol, setCursorCol] = useState(editorUi.cursorCol);

  // Delete confirmation dialog state.
  const [deleteConfirm, setDeleteConfirm] = useState<{
    relPath: string;
    name: string;
    isDir: boolean;
  } | null>(null);

  // Track whether we've already restored the open-file session for this server.
  const restoredRef = useRef(false);

  // ── Drag-drop shared state ───────────────────────────────────────────────
  // Ref holds the latest hovered directory path (updated by FileTree on
  // dragover/dragleave). State is for React re-renders (visual feedback).
  const dragOverRelPathRef = useRef<string | null>(null);
  const [dragOverRelPath, setDragOverRelPath] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const handleDragOverChange = useCallback((path: string | null) => {
    dragOverRelPathRef.current = path;
    setDragOverRelPath(path);
  }, []);

  // Set up Tauri's native drag-drop listener for OS file drops.
  // HTML5 DnD doesn't expose file data in Tauri's webview — we need the
  // onDragDropEvent API which provides absolute file paths.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (cancelled) return;

          if (event.payload.type === "drop") {
            // Read the target directory from the shared ref (last dragover).
            const targetDir = dragOverRelPathRef.current ?? "";
            // Copy each dropped file into the server directory.
            invoke("copy_files_to_server", {
              id: serverId,
              sourcePaths: event.payload.paths,
              targetRelPath: targetDir,
            }).then(() => {
              if (!cancelled) setRefreshTree((k) => k + 1);
            }).catch((e) => {
              console.error("Drop copy failed:", e);
            });
            // Clear highlight.
            handleDragOverChange(null);
          } else if (event.payload.type === "leave") {
            handleDragOverChange(null);
          }
          // 'enter' and 'over' types: visual feedback handled by HTML5 dragover.
        });
      } catch (e) {
        console.warn("Failed to register Tauri drag-drop listener:", e);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [serverId, handleDragOverChange]);

  // ── Auto-refresh: window focus + filesystem watcher ─────────────────────
  // Two complementary signals bump `refreshTree` so the explorer stays current
  // with both external edits and writes from the running server process.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (!cancelled && focused) setRefreshTree((k) => k + 1);
        });
      } catch (e) {
        console.warn("Failed to register window focus listener:", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Register the backend watcher for this instance on mount, listen for change
  // events, and unwatch on unmount.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        await invoke("watch_server_directory", { id: serverId });
        unlisten = await listen<{ path: string }>("server://fs-changed", () => {
          if (!cancelled) setRefreshTree((k) => k + 1);
        });
      } catch (e) {
        console.warn("Failed to start file watcher:", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      invoke("unwatch_server_directory", { id: serverId }).catch(() => {
        // Non-fatal — directory may already be gone.
      });
    };
  }, [serverId]);

  // ── Keyboard shortcuts: Ctrl/Cmd+F to toggle search, Esc to close ───────
  // Both are captured on the *capture* phase but ONLY fire when the Monaco
  // editor doesn't have focus — so the editor keeps its own Ctrl+F (find) and
  // Esc (close find widget / exit snippet) behaviour. Editor focus is tracked
  // by CodeEditor via Monaco's own onDidFocusEditorText/Blur events and
  // exposed through the shared `editorFocus` singleton — more reliable than
  // inspecting document.activeElement inside Tauri's webview.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd+F → toggle search (unless the editor is focused).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (editorFocus.focused) return;
        e.preventDefault();
        e.stopPropagation();
        setShowSearch((s) => !s);
        return;
      }
      // Escape → close search (unless the editor is focused).
      if (e.key === "Escape") {
        if (editorFocus.focused) return;
        setShowSearch((s) => {
          if (!s) return s;
          e.preventDefault();
          e.stopPropagation();
          return false;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Restore open files on mount: reload each persisted path from disk.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const paths = editorUi.openFiles;
    if (paths.length === 0) return;

    // Open files sequentially so the last one becomes active (matching the
    // persisted activeFile). We don't await the final active-file set —
    // openFile already sets active state internally.
    let cancelled = false;
    (async () => {
      for (const relPath of paths) {
        if (cancelled) break;
        try {
          await openFile(relPath);
        } catch {
          // File may have been deleted since last session — skip it.
        }
      }
      // Set the final active file (in case an earlier open overrode it).
      if (!cancelled && editorUi.activeFile && paths.includes(editorUi.activeFile)) {
        setActiveFile(editorUi.activeFile);
      }
    })();

    return () => {
      cancelled = true;
    };
    // We intentionally run this only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wrapped actions

  const handleSetActiveFile = useCallback(
    (relPath: string | null) => {
      setActiveFile(relPath);
      updateServer(serverId, {
        editor: {
          ...editorUi,
          openFiles: Array.from(openFiles.keys()),
          activeFile: relPath,
          expandedPaths: Array.from(expandedPaths),
          cursorLine,
          cursorCol,
        },
      });
    },
    [setActiveFile, serverId, updateServer, editorUi, openFiles, expandedPaths, cursorLine, cursorCol],
  );

  const handleOpenFile = useCallback(
    async (relPath: string) => {
      await openFile(relPath);
      const newOpenFiles = Array.from(openFiles.keys());
      if (!openFiles.has(relPath)) {
        newOpenFiles.push(relPath);
      }
      updateServer(serverId, {
        editor: {
          ...editorUi,
          openFiles: newOpenFiles,
          activeFile: relPath,
          expandedPaths: Array.from(expandedPaths),
          cursorLine,
          cursorCol,
        },
      });
    },
    [openFile, openFiles, serverId, updateServer, editorUi, expandedPaths, cursorLine, cursorCol],
  );

  const handleCloseFile = useCallback(
    (relPath: string) => {
      const file = openFiles.get(relPath);
      if (file?.isDirty) {
        saveFile(relPath).then(() => closeFile(relPath));
        return;
      }
      closeFile(relPath);
      const newOpenFiles = Array.from(openFiles.keys()).filter((p) => p !== relPath);
      const newActive = activeFile === relPath ? (newOpenFiles[newOpenFiles.length - 1] ?? null) : activeFile;
      updateServer(serverId, {
        editor: {
          ...editorUi,
          openFiles: newOpenFiles,
          activeFile: newActive,
          expandedPaths: Array.from(expandedPaths),
          cursorLine,
          cursorCol,
        },
      });
    },
    [openFiles, saveFile, closeFile, activeFile, serverId, updateServer, editorUi, expandedPaths, cursorLine, cursorCol],
  );

  const handleSave = useCallback(async () => {
    if (!activeFile) return;
    await saveFile(activeFile);
  }, [activeFile, saveFile]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeFile || value === undefined) return;
      setFileContent(activeFile, value);
    },
    [activeFile, setFileContent],
  );

  const handleCursorPosition = useCallback(
    (line: number, column: number) => {
      setCursorLine(line);
      setCursorCol(column);
      updateServer(serverId, {
        editor: {
          ...editorUi,
          openFiles: Array.from(openFiles.keys()),
          activeFile,
          expandedPaths: Array.from(expandedPaths),
          cursorLine: line,
          cursorCol: column,
        },
      });
    },
    [serverId, updateServer, editorUi, openFiles, activeFile, expandedPaths],
  );

  const handleToggleExpand = useCallback(
    (relPath: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(relPath)) {
          next.delete(relPath);
        } else {
          next.add(relPath);
        }
        updateServer(serverId, {
          editor: {
            ...editorUi,
            openFiles: Array.from(openFiles.keys()),
            activeFile,
            expandedPaths: Array.from(next),
            cursorLine,
            cursorCol,
          },
        });
        return next;
      });
    },
    [serverId, updateServer, editorUi, openFiles, activeFile, cursorLine, cursorCol],
  );

  // ── New file / folder ────────────────────────────────────────────────────

  const handleCreateFile = useCallback(
    async (parentRelPath: string, name: string) => {
      const fullPath = parentRelPath ? `${parentRelPath}/${name}` : name;
      await createFile(fullPath);
      setRefreshTree((k) => k + 1);
      // Open the newly created file in the editor.
      await handleOpenFile(fullPath);
    },
    [createFile, handleOpenFile],
  );

  const handleCreateFolder = useCallback(
    async (parentRelPath: string, name: string) => {
      const fullPath = parentRelPath ? `${parentRelPath}/${name}` : name;
      await createDirectory(fullPath);
      setRefreshTree((k) => k + 1);
    },
    [createDirectory],
  );

  // ── Rename ───────────────────────────────────────────────────────────────

  const handleRename = useCallback(
    async (oldRelPath: string, newRelPath: string) => {
      await renamePath(oldRelPath, newRelPath);
      setRefreshTree((k) => k + 1);
    },
    [renamePath],
  );

  // ── Delete ───────────────────────────────────────────────────────────────

  const handleDeleteRequest = useCallback(
    (relPath: string, isDir: boolean) => {
      const name = relPath.split("/").pop() ?? relPath;
      setDeleteConfirm({ relPath, name, isDir });
    },
    [],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    await deletePath(deleteConfirm.relPath);
    setDeleteConfirm(null);
    setRefreshTree((k) => k + 1);
  }, [deleteConfirm, deletePath]);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirm(null);
  }, []);

  // ── Reveal in explorer / copy path ───────────────────────────────────────

  const handleRevealInExplorer = useCallback(
    async (relPath: string) => {
      try {
        await invoke("open_server_path", { id: serverId, relPath });
      } catch (e) {
        console.error("Reveal in explorer failed:", e);
      }
    },
    [serverId],
  );

  const handleCopyPath = useCallback(
    async (relPath: string) => {
      try {
        await navigator.clipboard.writeText(relPath);
      } catch (e) {
        console.error("Copy path failed:", e);
      }
    },
    [],
  );

  // ── Drag-and-drop: move within tree ──────────────────────────────────────

  const handleMoveFile = useCallback(
    async (sourceRelPath: string, targetDirRelPath: string) => {
      const name = sourceRelPath.split("/").pop() ?? sourceRelPath;
      const newRelPath = targetDirRelPath ? `${targetDirRelPath}/${name}` : name;
      if (newRelPath === sourceRelPath) return;
      await renamePath(sourceRelPath, newRelPath);
      setRefreshTree((k) => k + 1);
    },
    [renamePath],
  );

  // Trigger a tree refresh when openFiles size changes (file was created/deleted).
  useEffect(() => {
    setRefreshTree((t) => t + 1);
  }, [openFiles.size]);

  const activeLanguage = activeFileData?.language ?? "plaintext";
  const activeContent = activeFileData?.content ?? "";

  return (
    <div className="flex flex-1 min-h-0">
      {/* File tree sidebar */}
      <div className="relative w-[220px] shrink-0 flex flex-col border-r border-grid-bounds matrix-border">
        {/* Explorer header.
            The "explorer" label is clickable: it toggles the search popup on
            and off (clicking it again closes the overlay). */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-grid-bounds">
          <button
            onClick={() => setShowSearch((s) => !s)}
            className={`text-[10px] tracking-[0.2em] uppercase text-zinc-500 hover:text-zinc-300 transition-colors ${showSearch ? "text-signal-high" : ""}`}
            title={showSearch ? "Close search (Esc)" : "Search (Ctrl+F)"}
          >
            explorer
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setRefreshTree((k) => k + 1)}
              className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors px-1"
              title="Refresh"
            >
              refresh
            </button>
            <span className="text-[10px] text-zinc-600 tabular-nums ml-1">
              {tabs.length}
            </span>
          </div>
        </div>
        <FileTree
          serverId={serverId}
          activeFile={activeFile}
          onOpenFile={handleOpenFile}
          onListDirectory={listDirectory}
          expandedPaths={expandedPaths}
          onToggleExpand={handleToggleExpand}
          refreshKey={refreshTree}
          // New file/folder
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          // Rename/move
          onRename={handleRename}
          onMoveFile={handleMoveFile}
          // Delete
          onDelete={handleDeleteRequest}
          // Context actions
          onRevealInExplorer={handleRevealInExplorer}
          onCopyPath={handleCopyPath}
          // Drag-drop shared state (visual feedback from Tauri + HTML5)
          dragOverRelPath={dragOverRelPath}
          onDragOverChange={handleDragOverChange}
        />
        {showSearch && (
          <div className="absolute top-[29px] left-0 right-0 bottom-0 z-30 bg-bg-core border-b border-grid-bounds shadow-xl flex flex-col">
            <FileSearchPanel
              serverId={serverId}
              onOpenFile={handleOpenFile}
              onClose={() => setShowSearch(false)}
            />
          </div>
        )}
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        {tabs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center bg-bg-core">
            <div className="text-center">
              <p className="text-[11px] text-zinc-600 mb-1">
                no files open
              </p>
              <p className="text-[10px] text-zinc-700">
                select a file in the explorer to start editing
              </p>
            </div>
          </div>
        ) : (
          <>
            <EditorTabBar
              tabs={tabs}
              activeFile={activeFile}
              onSelect={handleSetActiveFile}
              onClose={handleCloseFile}
              onSave={handleSave}
            />
            <div className="flex-1 min-h-0">
              {activeFileData && (
                <CodeEditor
                  key={activeFile}
                  language={activeLanguage}
                  value={activeContent}
                  onChange={handleEditorChange}
                  onSave={handleSave}
                  onCursorPosition={handleCursorPosition}
                  path={activeFile ?? undefined}
                  readOnly={false}
                />
              )}
            </div>
            {/* Status bar */}
            <div className="flex items-center justify-between h-6 px-3 border-t border-grid-bounds bg-bg-surface shrink-0">
              <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                <span className="tabular-nums">
                  Ln {cursorLine}, Col {cursorCol}
                </span>
                <span>
                  {activeLanguage}
                </span>
                <span>
                  UTF-8
                </span>
                {dirtyCount > 0 && (
                  <span className="text-warn-vector">
                    {dirtyCount} unsaved
                  </span>
                )}
                {busy && (
                  <span className="text-signal-high">saving…</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={!activeFileData?.isDirty || busy}
                  className="text-[10px] text-signal-high hover:text-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Save (Ctrl+S)"
                >
                  save
                </button>
                {dirtyCount > 0 && (
                  <button
                    onClick={() => saveAllFiles()}
                    className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors"
                    title="Save All"
                  >
                    save all
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-fault-vector/40 bg-fault-vector/5">
            <span className="text-[10px] text-fault-vector flex-1">{error}</span>
            <button
              onClick={clearError}
              className="text-[10px] text-zinc-500 hover:text-zinc-200"
            >
              dismiss
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteConfirm !== null}
        title="Delete"
        message={
          deleteConfirm
            ? deleteConfirm.isDir
              ? `This will permanently delete "${deleteConfirm.name}" and ALL its contents.`
              : `Permanently delete "${deleteConfirm.name}"?`
            : ""
        }
        confirmLabel="delete"
        cancelLabel="cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}
