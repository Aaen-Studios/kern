/**
 * downloadManager.ts — Progress-tracked download wrapper.
 *
 * Wraps the Tauri `download_url` command and subscribes to the
 * `download:<progressId>:progress` events that the Rust backend emits
 * (shape: { bytes, total }) so the caller can show determinate progress.
 *
 * All Tauri IPC (invoke + listen) is passed in by the caller via the
 * hostAPI handle to avoid dynamic imports that fail in asset://
 * Shadow DOM contexts.
 */

export interface DownloadCallbacks {
  onProgress?: (bytes: number, total: number) => void;
  onComplete?: () => void;
  onError?: (err: string) => void;
}

export interface DownloadHandle {
  cancel: () => void;
}

/** Shape of the progress event payload emitted by the Rust backend. */
export interface ProgressPayload {
  bytes: number;
  total: number;
}

/**
 * Downloads a URL to a file on disk.
 *
 * Uses `invoke` (from hostAPI, passed by the caller) to call the
 * Tauri `download_url` command, and subscribes to the
 * `download:<progressId>:progress` events to report determinate progress.
 *
 * @param url    - The URL to download.
 * @param dest   - Absolute destination path on disk.
 * @param invoke - The hostAPI invoke function.
 * @param listen - The hostAPI listen function.
 * @param callbacks - Lifecycle callbacks.
 */
export function downloadWithProgress(
  url: string,
  dest: string,
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  listen: (event: string, handler: (payload: unknown) => void) => Promise<() => void>,
  callbacks: DownloadCallbacks,
): DownloadHandle {
  let cancelled = false;
  let unlisten: (() => void) | null = null;

  const progressId = `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Subscribe to progress events before starting the download.
  void listen(`download:${progressId}:progress`, (payload) => {
    if (cancelled) return;
    const p = payload as ProgressPayload;
    callbacks.onProgress?.(p.bytes, p.total);
  }).then((fn) => { unlisten = fn; }).catch(() => { /* non-fatal */ });

  invoke("download_url", { url, dest, progressId })
    .then(() => {
      if (!cancelled) {
        unlisten?.();
        callbacks.onComplete?.();
      }
    })
    .catch((err: unknown) => {
      if (!cancelled) {
        unlisten?.();
        callbacks.onError?.(String(err));
      }
    });

  return {
    cancel: () => {
      cancelled = true;
      unlisten?.();
    },
  };
}

/**
 * Downloads and extracts a Temurin JDK of the given major version into
 * `destDir` (the instance sandbox's `jdk/` folder). Wraps the Tauri
 * `download_java` command and subscribes to `download:<progressId>:progress`
 * events to report determinate progress.
 */
/** A detected/installed JDK, returned by the `download_java` command. */
export interface JavaInstallResult {
  path: string;
  version: string;
  majorVersion: number;
}

export function downloadJava(
  major: number,
  destDir: string,
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  listen: (event: string, handler: (payload: unknown) => void) => Promise<() => void>,
  callbacks: Omit<DownloadCallbacks, "onComplete"> & {
    onComplete?: (install: JavaInstallResult) => void;
  },
): DownloadHandle {
  let cancelled = false;
  let unlisten: (() => void) | null = null;

  const progressId = `jdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  void listen(`download:${progressId}:progress`, (payload) => {
    if (cancelled) return;
    const p = payload as ProgressPayload;
    callbacks.onProgress?.(p.bytes, p.total);
  }).then((fn) => { unlisten = fn; }).catch(() => { /* non-fatal */ });

  invoke("download_java", { major, destDir, progressId })
    .then((result) => {
      if (!cancelled) {
        unlisten?.();
        callbacks.onComplete?.(result as JavaInstallResult);
      }
    })
    .catch((err: unknown) => {
      if (!cancelled) {
        unlisten?.();
        callbacks.onError?.(String(err));
      }
    });

  return {
    cancel: () => {
      cancelled = true;
      unlisten?.();
    },
  };
}
