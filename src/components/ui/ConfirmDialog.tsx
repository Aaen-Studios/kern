import { useEffect, useRef, useState } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" renders the confirm button with the fault-vector (red) palette. */
  variant?: "danger" | "default";
  /**
   * Optional secondary action rendered as a checkbox above the buttons.
   * Unchecked by default. The parent reads `onOptionalAction` to determine
   * whether the user opted in (e.g. "also delete the folder on disk").
   */
  optionalActionLabel?: string;
  onOptionalAction?: (checked: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Lightweight modal overlay for confirming destructive or important actions.
 *
 * Matches the kern dark-room palette (DesignGuide §2). Rendered at a fixed
 * position so it layers over whatever view is active. Closes on Escape or
 * clicking the backdrop — the cancel action is always available.
 *
 * Focus is trapped inside the dialog while open so keyboard users don't
 * tab onto hidden controls behind the overlay.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "confirm",
  cancelLabel = "cancel",
  variant = "default",
  optionalActionLabel,
  onOptionalAction,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [optionalChecked, setOptionalChecked] = useState(false);

  // Reset the checkbox whenever the dialog opens.
  useEffect(() => {
    if (open) setOptionalChecked(false);
  }, [open]);

  // Focus the confirm button when opened; return focus on close.
  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = variant === "danger";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      // Click on the backdrop = cancel.
      onClick={onCancel}
    >
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Dialog */}
      <div
        className="relative z-10 w-full max-w-sm border border-grid-bounds bg-bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2
          id="confirm-title"
          className="text-xs text-zinc-200 mb-1 tracking-[0.15em] uppercase"
        >
          {title}
        </h2>
        <p className="text-[11px] text-zinc-400 leading-relaxed mb-4">
          {message}
        </p>

        {optionalActionLabel && (
          <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={optionalChecked}
              onChange={(e) => {
                setOptionalChecked(e.target.checked);
                onOptionalAction?.(e.target.checked);
              }}
              className="accent-fault-vector"
            />
            <span className="text-[11px] text-zinc-400">
              {optionalActionLabel}
            </span>
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-zinc-400 border border-grid-bounds hover:border-signal-low hover:text-zinc-200 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-3 py-1.5 text-xs font-semibold transition-opacity ${
              isDanger
                ? "text-bg-core bg-fault-vector hover:opacity-80"
                : "text-bg-core bg-signal-high hover:opacity-80"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
