import { useEffect, useRef, useCallback } from "react";

interface InlineInputProps {
  value?: string;
  placeholder?: string;
  selectExtension?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Inline text input for rename/create operations in tree views.
 *
 * Auto-focuses on mount, supports Enter to submit and Escape to cancel.
 * When selectExtension is true and a value is provided, selects the name
 * portion before the first dot (preserving file extension for renaming).
 */
export function InlineInput({
  value,
  placeholder,
  selectExtension,
  onSubmit,
  onCancel,
}: InlineInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (value !== undefined && selectExtension) {
      // Select the name part before the first dot (preserve extension).
      const dotIdx = value.indexOf(".");
      if (dotIdx > 0) {
        el.setSelectionRange(0, dotIdx);
      } else {
        el.select();
      }
    } else {
      el.select();
    }
  }, [value, selectExtension]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmit(inputRef.current?.value ?? "");
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [onSubmit, onCancel],
  );

  return (
    <input
      ref={inputRef}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onKeyDown={handleKey}
      onBlur={(e) => {
        // On blur, submit if non-empty, cancel otherwise.
        const v = e.target.value.trim();
        if (v) {
          onSubmit(v);
        } else {
          onCancel();
        }
      }}
      className="flex-1 bg-bg-core border border-signal-high/60 text-[11px] text-zinc-200 px-1.5 py-0.5 outline-none min-w-0"
      spellCheck={false}
      autoComplete="off"
    />
  );
}