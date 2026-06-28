import { useState } from "react";
import type { NewServerInput, ServerInstance } from "../../types/server";

interface ServerFormProps {
  /** When present, the form edits this instance; otherwise it creates a new one. */
  initial?: ServerInstance;
  onSubmit: (input: NewServerInput) => Promise<void>;
  onCancel: () => void;
}

/**
 * Create / edit form. Phase 1 captures the core registry fields (name, type,
 * path) plus free-form key/value user overrides. Phase 3 will replace the
 * override editor with a schema-driven DynamicForm once the manifest engine
 * exists (ArchitecturePlan §4).
 */
export function ServerForm({ initial, onSubmit, onCancel }: ServerFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [serverType, setServerType] = useState(initial?.serverType ?? "web_server");
  const [path, setPath] = useState(initial?.path ?? "");
  // Overrides rendered as editable key/value rows for Phase 1 flexibility.
  const [overrides, setOverrides] = useState<{ key: string; value: string }[]>(
    Object.entries(initial?.userOverrides ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateOverride(index: number, patch: Partial<{ key: string; value: string }>) {
    setOverrides((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addOverride() {
    setOverrides((rows) => [...rows, { key: "", value: "" }]);
  }
  function removeOverride(index: number) {
    setOverrides((rows) => rows.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("name is required");
    if (!path.trim()) return setError("path is required");

    const userOverrides: Record<string, string> = {};
    for (const row of overrides) {
      const key = row.key.trim();
      if (!key) continue;
      userOverrides[key] = row.value;
    }

    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), serverType, path: path.trim(), userOverrides });
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !submitting) onCancel();
      }}
      className="max-w-xl p-4 space-y-5"
    >
      <h2 className="text-[10px] tracking-[0.2em] uppercase text-zinc-500">
        {initial ? "edit instance" : "register instance"}
      </h2>

      <Field label="name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Production API"
          className={inputClass}
        />
      </Field>

      <Field label="server type">
        <select
          value={serverType}
          onChange={(e) => setServerType(e.target.value)}
          className={inputClass}
        >
          <option value="web_server">web_server</option>
          <option value="discord_bot">discord_bot</option>
          <option value="database">database</option>
          <option value="custom">custom</option>
        </select>
      </Field>

      <Field label="path">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:\\Projects\\my-web-api"
          className={`${inputClass} font-mono`}
        />
        <p className="mt-1 text-[10px] text-zinc-600">
          absolute path to the instance working directory
        </p>
      </Field>

      <fieldset>
        <div className="flex items-center justify-between mb-2">
          <legend className="text-[10px] tracking-[0.2em] uppercase text-zinc-500">
            user overrides
          </legend>
          <button
            type="button"
            onClick={addOverride}
            className="px-2 py-0.5 text-[11px] text-zinc-400 border border-grid-bounds hover:border-signal-low hover:text-zinc-200 transition-colors"
          >
            + add
          </button>
        </div>
        <div className="space-y-2">
          {overrides.map((row, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={row.key}
                onChange={(e) => updateOverride(i, { key: e.target.value })}
                placeholder="key"
                className={`${inputClass} flex-1 font-mono`}
              />
              <input
                value={row.value}
                onChange={(e) => updateOverride(i, { value: e.target.value })}
                placeholder="value"
                className={`${inputClass} flex-1 font-mono`}
              />
              <button
                type="button"
                onClick={() => removeOverride(i)}
                className="px-2 text-[11px] text-zinc-600 hover:text-fault-vector transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
          {overrides.length === 0 && (
            <p className="text-[11px] text-zinc-600">no overrides configured</p>
          )}
        </div>
      </fieldset>

      {error && (
        <p className="text-[11px] text-fault-vector border border-fault-vector/40 bg-fault-vector/5 px-2 py-1">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-3 py-1.5 text-xs text-bg-core bg-signal-high hover:opacity-80 font-semibold transition-opacity disabled:opacity-50"
        >
          {submitting ? "saving…" : initial ? "save changes" : "register"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-zinc-400 border border-grid-bounds hover:border-signal-low hover:text-zinc-200 transition-colors"
        >
          cancel
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full bg-bg-core border border-grid-bounds px-2 py-1.5 text-xs text-zinc-200 focus:border-signal-low transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-1 text-[10px] tracking-[0.2em] uppercase text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}
