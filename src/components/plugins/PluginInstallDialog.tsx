import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

interface PluginInstallDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful install so the parent can refresh the plugin list. */
  onInstalled: () => void;
}

/**
 * Modal dialog for installing a community plugin from disk.
 *
 * Uses the Tauri native file dialog to let the user select a plugin directory
 * or a manifest.json file. The Rust core copies the plugin into
 * `<app_data>/plugins/<id>/` and returns the parsed Manifest on success.
 *
 * Styling follows the ConfirmDialog pattern — dark scrim, centered card,
 * Escape / backdrop-click to close.
 */
export function PluginInstallDialog({
  isOpen,
  onClose,
  onInstalled,
}: PluginInstallDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setSelectedPath(null);
      setSelectedName(null);
      setInstalling(false);
      setError(null);
    }
  }, [isOpen]);

  // Focus the cancel button when opened; close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    cancelRef.current?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  /** Open the native file dialog to pick a plugin directory or manifest.json. */
  async function handleBrowse() {
    try {
      // First try picking a directory (the common case).
      const dir = await open({
        multiple: false,
        directory: true,
        title: "Select plugin directory",
      });
      if (dir) {
        setSelectedPath(dir as string);
        // Show just the last segment as the label.
        const label = (dir as string).replace(/[/\\]$/, "").split(/[/\\]/).pop() ?? (dir as string);
        setSelectedName(label);
        setError(null);
        return;
      }
    } catch {
      // directory picker might not be supported on all platforms; fall through
      // to the file picker below.
    }

    // Fallback: pick a manifest.json file.
    try {
      const file = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "manifest",
            extensions: ["json"],
          },
        ],
        title: "Select manifest.json",
      });
      if (file) {
        setSelectedPath(file as string);
        setSelectedName((file as string).split(/[/\\]/).pop() ?? (file as string));
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleInstall() {
    if (!selectedPath) return;
    setInstalling(true);
    setError(null);
    try {
      await invoke("install_plugin", { sourcePath: selectedPath });
      onInstalled();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Dialog */}
      <div
        className="relative z-10 w-full max-w-sm border border-grid-bounds bg-bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-dialog-title"
      >
        <h2
          id="install-dialog-title"
          className="text-xs text-zinc-200 mb-1 tracking-[0.15em] uppercase"
        >
          install plugin
        </h2>
        <p className="text-[11px] text-zinc-500 mb-4 leading-relaxed">
          Select the plugin directory or its{" "}
          <code className="text-zinc-400">manifest.json</code> file.
        </p>

        {/* Selected path display */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={handleBrowse}
            disabled={installing}
            className="px-3 py-1.5 text-xs text-zinc-200 border border-signal-low hover:border-signal-high hover:text-signal-high font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            browse…
          </button>
          <span className="text-[11px] text-zinc-500 truncate flex-1 min-w-0">
            {selectedName ?? "no selection"}
          </span>
        </div>

        {/* Error feedback */}
        {error && (
          <p className="mb-4 text-[11px] text-fault-vector border border-fault-vector/40 bg-fault-vector/5 px-2 py-1">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onClose}
            disabled={installing}
            className="px-3 py-1.5 text-xs text-zinc-400 border border-grid-bounds hover:border-signal-low hover:text-zinc-200 transition-colors disabled:opacity-40"
          >
            cancel
          </button>
          <button
            onClick={handleInstall}
            disabled={!selectedPath || installing}
            className="px-3 py-1.5 text-xs font-semibold text-bg-core bg-signal-high hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {installing ? "installing…" : "install"}
          </button>
        </div>
      </div>
    </div>
  );
}
