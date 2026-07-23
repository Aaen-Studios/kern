/**
 * Global toast / notification center.
 *
 * Today the app surfaces errors as ephemeral inline banners local to each
 * component (ServerDetailView, App, FileEditorPanel) — so a message vanishes
 * the moment the user navigates away, and there's no history. This module
 * provides a single persistent channel: push a notification, it stacks in the
 * top-right corner, auto-dismisses after a timeout (errors stay longer), and
 * the user can dismiss manually.
 *
 * Usage:
 *   const { notify } = useToast();
 *   notify({ kind: "error", title: "Save failed", message: "disk full" });
 *
 * Mounted as a provider at the app root (so leaf hooks can reach it without
 * prop-drilling) and rendered as a fixed-position container overlaying all
 * views — it survives navigation and view crashes alike.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Severity → drives color + auto-dismiss delay. */
export type ToastKind = "error" | "warn" | "success" | "info";

export interface Toast {
  /** Stable id (assigned by the provider). */
  id: number;
  kind: ToastKind;
  /** Short uppercase label, e.g. "ERROR", "SAVED". */
  title: string;
  /** Detail body. Optional. */
  message?: string;
  /** Epoch ms when pushed — used for ordering + history. */
  at: number;
}

interface NotifyOptions {
  kind: ToastKind;
  title: string;
  message?: string;
  /** Override the auto-dismiss delay (ms). 0 = sticky (no auto-dismiss). */
  durationMs?: number;
}

interface ToastContextValue {
  /** Push a notification. Returns the toast id. */
  notify: (opts: NotifyOptions) => number;
  /** Dismiss a specific notification by id. */
  dismiss: (id: number) => void;
  /** Dismiss all. */
  clear: () => void;
  /** Currently-visible notifications (newest first). */
  toasts: Toast[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Default auto-dismiss per kind. Errors linger longer; success is brief. */
const DEFAULT_DURATION: Record<ToastKind, number> = {
  error: 8000,
  warn: 6000,
  info: 5000,
  success: 3500,
};

const MAX_VISIBLE = 5;

/**
 * Provider that owns the toast queue and the auto-dismiss timers.
 *
 * Timers are tracked in a ref map so they can be cleared on manual dismiss
 * (otherwise a sticky-then-dismissed toast could still be reaped late).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (opts: NotifyOptions): number => {
      const id = nextId.current++;
      const toast: Toast = {
        id,
        kind: opts.kind,
        title: opts.title,
        message: opts.message,
        at: Date.now(),
      };
      setToasts((prev) => {
        // newest first, cap the stack so a runaway error loop can't bury the UI.
        const next = [toast, ...prev];
        return next.slice(0, MAX_VISIBLE);
      });

      const duration = opts.durationMs ?? DEFAULT_DURATION[opts.kind];
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const clear = useCallback(() => {
    setToasts([]);
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ notify, dismiss, clear, toasts }),
    [notify, dismiss, clear, toasts],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Access the toast channel. Must be used inside <ToastProvider>. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

// ─── Container UI ──────────────────────────────────────────────────────────
// Rendered once at the app root as a sibling of the main shell. Fixed to the
// top-right corner, stacked vertically, each toast styled to match the kern
// palette (see global.css tokens).

const KIND_STYLES: Record<ToastKind, { accent: string; label: string }> = {
  error: { accent: "text-fault-vector border-fault-vector/40 bg-fault-vector/5", label: "ERROR" },
  warn: { accent: "text-warn-vector border-warn-vector/40 bg-warn-vector/5", label: "WARN" },
  success: { accent: "text-signal-high border-signal-low bg-signal-high/5", label: "OK" },
  info: { accent: "text-zinc-300 border-grid-bounds bg-bg-surface", label: "INFO" },
};

/** The visible stack. Mount this once, near the app root. */
export function ToastViewport() {
  const { toasts, dismiss, clear } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-3 right-3 z-[60] flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map((t) => {
        const style = KIND_STYLES[t.kind];
        return (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto border ${style.accent} px-3 py-2`}
            style={{ animation: "toast-in 160ms ease-out" }}
          >
            <div className="flex items-start gap-2">
              <span className="text-[10px] tracking-[0.2em] uppercase mt-px shrink-0">
                {style.label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-zinc-200 font-medium leading-snug">
                  {t.title}
                </p>
                {t.message && (
                  <p className="text-[10px] text-zinc-500 mt-0.5 leading-snug break-words">
                    {t.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="text-[10px] text-zinc-600 hover:text-zinc-200 shrink-0 transition-colors"
                aria-label="dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
      {toasts.length > 1 && (
        <button
          onClick={clear}
          className="pointer-events-auto self-end text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors pr-1"
        >
          clear all
        </button>
      )}
    </div>
  );
}
