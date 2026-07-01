import { useEffect, useRef, useState, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import type { Update, DownloadEvent } from "@tauri-apps/plugin-updater";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

/**
 * In-app auto-updater banner + modal.
 *
 * On mount, polls the configured updater endpoint (see `plugins.updater` in
 * tauri.conf.json). When an update is found, shows a slim banner across the
 * top of the window; clicking through opens a modal that downloads the signed
 * archive with a live progress bar, then installs + relaunches.
 *
 * State lives locally — kern has no global store, so this component owns the
 * whole update lifecycle and renders nothing once idle.
 */
export default function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>("checking");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Live update handle from the initial check(); kept in a ref so the
  // download/install callbacks can reach it without re-running the effect.
  const updateRef = useRef<Update | null>(null);
  // Mutable mirror of `total` so the download progress callback (created once
  // at download start) always reads the latest value instead of a stale
  // `undefined` captured in its closure.
  const totalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (dismissed) return;
    setStatus("checking");
    setError(null);
    check({ timeout: 10000 })
      .then((u) => {
        if (u) {
          updateRef.current = u;
          setVersion(u.version);
          setStatus("available");
        } else {
          setStatus("idle");
        }
      })
      .catch(() => setStatus("idle"));
  }, [dismissed]);

  const handleUpgrade = useCallback(async () => {
    const u = updateRef.current;
    if (!u) return;
    setStatus("downloading");
    setDownloaded(0);
    setTotal(undefined);
    totalRef.current = undefined;
    try {
      await u.download((event: DownloadEvent) => {
        if (event.event === "Started") {
          totalRef.current = event.data.contentLength;
          setTotal(event.data.contentLength);
          setDownloaded(0);
        } else if (event.event === "Progress") {
          setDownloaded((prev) => {
            const next = prev + event.data.chunkLength;
            const t = totalRef.current;
            if (t) setProgress(Math.min(100, Math.round((next / t) * 100)));
            return next;
          });
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
      setStatus("downloaded");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const handleInstall = useCallback(async () => {
    const u = updateRef.current;
    if (!u) return;
    setStatus("installing");
    try {
      await u.install();
      // A successful install exits the app to run the installer, so the UI
      // below rarely re-renders — but reset anyway so a later session can
      // prompt again if the install didn't actually complete.
      setDismissed(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setStatus("idle");
    setError(null);
  }, []);

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (status === "idle" || status === "checking" || dismissed) return null;

  // ── Slim banner: an update is available, nothing downloading yet ──
  if (status === "available") {
    return (
      <div className="flex items-center gap-3 px-3 py-1.5 text-xs font-mono bg-bg-surface border-b border-grid-bounds text-signal-high">
        <span className="text-warn-vector">▲</span>
        <span className="text-zinc-300">
          update available: <span className="text-signal-high">v{version}</span>
        </span>
        <button
          onClick={handleUpgrade}
          className="px-2 py-0.5 text-signal-high border border-signal-low hover:border-signal-high hover:bg-signal-high/10 transition-colors"
        >
          upgrade
        </button>
        <button
          onClick={handleDismiss}
          className="px-2 py-0.5 text-signal-low hover:text-zinc-300 transition-colors"
        >
          later
        </button>
      </div>
    );
  }

  // ── Modal overlay: download / install / error ──
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 font-mono">
      <div className="w-[420px] max-w-[90vw] border border-grid-bounds bg-bg-surface">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-grid-bounds">
          <span
            className={
              status === "downloading"
                ? "text-signal-high"
                : status === "downloaded"
                ? "text-signal-high"
                : status === "installing"
                ? "text-warn-vector"
                : "text-fault-vector"
            }
          >
            {status === "downloading" && "▼"}
            {status === "downloaded" && "●"}
            {status === "installing" && "↻"}
            {status === "error" && "✕"}
          </span>
          <span className="text-xs uppercase tracking-wider text-zinc-400">
            {status === "downloading" && `downloading v${version}`}
            {status === "downloaded" && "download complete"}
            {status === "installing" && "installing"}
            {status === "error" && "update failed"}
          </span>
        </div>

        {/* Body */}
        {status === "downloading" && (
          <div className="px-4 py-4 space-y-2">
            <div className="h-1.5 w-full bg-grid-bounds overflow-hidden">
              <div
                className="h-full bg-signal-high transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-signal-low">
              <span>
                {formatBytes(downloaded)}
                {total !== undefined && ` / ${formatBytes(total)}`}
              </span>
              <span className="text-signal-high">{progress}%</span>
            </div>
          </div>
        )}

        {status === "downloaded" && (
          <div className="flex items-center justify-end gap-2 px-4 py-4">
            <button
              onClick={handleInstall}
              className="px-3 py-1 text-xs text-bg-core bg-signal-high hover:brightness-110 transition-[filter]"
            >
              install &amp; restart
            </button>
            <button
              onClick={handleDismiss}
              className="px-3 py-1 text-xs text-signal-low border border-grid-bounds hover:text-zinc-300 transition-colors"
            >
              later
            </button>
          </div>
        )}

        {status === "installing" && (
          <div className="px-4 py-4 text-[11px] text-signal-low">
            the application will restart
          </div>
        )}

        {status === "error" && (
          <div className="px-4 py-4 space-y-3">
            <div className="text-[11px] text-fault-vector break-words">
              {error || "something went wrong"}
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleDismiss}
                className="px-3 py-1 text-xs text-signal-low border border-grid-bounds hover:text-zinc-300 transition-colors"
              >
                close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
