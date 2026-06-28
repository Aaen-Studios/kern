import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, NewServerInput, ServerInstance } from "../../types/server";
import { usePlugins } from "../../hooks/usePlugins";
import { DynamicForm } from "./DynamicForm";

interface ServerFormProps {
  /** When present, the form edits this instance; otherwise it creates a new one. */
  initial?: ServerInstance;
  onSubmit: (input: NewServerInput) => Promise<void>;
  onCancel: () => void;
}

/**
 * Create / edit form. Captures the core registry fields (name, type, path)
 * plus the plugin's configuration values.
 *
 * Uses a <div> instead of <form> to avoid React 19 form-element reconciliation
 * issues when this component is rapidly swapped out (edit→cancel→detail).
 * Enter-key submission is handled via onKeyDown, matching the existing Escape
 * handler pattern.
 */
export function ServerForm({ initial, onSubmit, onCancel }: ServerFormProps) {
  const { plugins, loading: pluginsLoading } = usePlugins();
  const [name, setName] = useState(initial?.name ?? "");
  const [serverType, setServerType] = useState(initial?.serverType ?? "");
  // For new instances the path starts empty, then is pre-filled once the
  // default sandbox path resolves. Editing an instance keeps its current path.
  const [path, setPath] = useState(initial?.path ?? "");
  const [overrides, setOverrides] = useState<{ key: string; value: string }[]>(
    Object.entries(initial?.userOverrides ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [schemaValues, setSchemaValues] = useState<Record<string, string>>(initial?.userOverrides ?? {});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill the path with the default sandbox path for new instances. We only
  // set it if the user hasn't typed anything yet, so a manual clear sticks.
  useEffect(() => {
    if (initial) return; // editing — keep the existing path
    let cancelled = false;
    (async () => {
      try {
        const cfg = await invoke<AppConfig>("get_config");
        if (cancelled) return;
        setPath((current) => (current.trim() ? current : cfg.settings.defaultSandboxPath));
      } catch {
        // Non-fatal — the user can always type a path manually.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial]);

  // The plugin whose manifest matches the selected server type, if any.
  const selectedPlugin = useMemo(
    () => plugins.find((p) => p.id === serverType),
    [plugins, serverType],
  );

  // Reset schema values when switching to a different plugin, so we don't
  // carry values from a previous schema into a new one.
  useEffect(() => {
    if (!selectedPlugin) setSchemaValues({});
  }, [selectedPlugin]);

  function updateOverride(index: number, patch: Partial<{ key: string; value: string }>) {
    setOverrides((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addOverride() {
    setOverrides((rows) => [...rows, { key: "", value: "" }]);
  }
  function removeOverride(index: number) {
    setOverrides((rows) => rows.filter((_, i) => i !== index));
  }

  /** Validates and submits the form data. */
  async function handleSave() {
    setError(null);

    if (!name.trim()) return setError("name is required");
    if (!serverType) return setError("select a server type");
    if (!path.trim()) return setError("path is required");

    // Build overrides from whichever editor is active.
    const userOverrides: Record<string, string> = selectedPlugin
      ? { ...schemaValues }
      : (() => {
          const map: Record<string, string> = {};
          for (const row of overrides) {
            const key = row.key.trim();
            if (key) map[key] = row.value;
          }
          return map;
        })();

    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), serverType, path: path.trim(), userOverrides });
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  /** Keyboard: Enter to save, Escape to cancel. */
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && !submitting) {
      onCancel();
      return;
    }
    if (e.key === "Enter" && !submitting) {
      // Don't capture Enter when a <select> is open.
      if (e.target instanceof HTMLSelectElement) return;
      handleSave();
    }
  }

  return (
    <div
      className="max-w-xl p-4 space-y-5"
      onKeyDown={handleKeyDown}
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
          className={`${inputClass} ${!serverType ? "text-zinc-600" : ""}`}
        >
          {/* Empty hidden option keeps nothing selected by default for new
              instances — the field stays blank until the user picks a type. */}
          {!serverType && !initial && <option value="" hidden></option>}
          {/* Installed plugins first, then a generic fallback. */}
          {plugins.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} ({p.id})
            </option>
          ))}
          <option value="custom">custom</option>
        </select>
        {pluginsLoading && (
          <p className="mt-1 text-[10px] text-zinc-600">loading plugins…</p>
        )}
        {selectedPlugin && (
          <p className="mt-1 text-[10px] text-zinc-600">
            {selectedPlugin.displayName} v{selectedPlugin.version}
            {selectedPlugin.author ? ` · ${selectedPlugin.author}` : ""}
          </p>
        )}
      </Field>

      <Field label="path">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:\\Projects\\my-bot"
          className={`${inputClass} font-mono`}
        />
        <p className="mt-1 text-[10px] text-zinc-600">
          absolute path to the instance working directory
          {!initial && " · pre-filled with the default sandbox"}
        </p>
      </Field>

      <fieldset>
        <legend className="mb-2 text-[10px] tracking-[0.2em] uppercase text-zinc-500">
          configuration
        </legend>
        {selectedPlugin ? (
          <DynamicForm
            schema={selectedPlugin.configSchema}
            values={schemaValues}
            onChange={(key, value) => {
              setSchemaValues((prev) => {
                const next = { ...prev, [key]: value };
                // Cascade: when a field changes, update any field whose
                // dependsOn points at it. e.g. entry follows runtime.
                for (const field of selectedPlugin.configSchema) {
                  if (field.dependsOn?.field === key) {
                    const derived = field.dependsOn.defaults[value];
                    if (derived !== undefined) {
                      next[field.key] = derived;
                    }
                  }
                }
                return next;
              });
            }}
          />
        ) : (
          <FreeFormOverrides
            rows={overrides}
            onAdd={addOverride}
            onUpdate={updateOverride}
            onRemove={removeOverride}
          />
        )}
      </fieldset>

      {error && (
        <p className="text-[11px] text-fault-vector border border-fault-vector/40 bg-fault-vector/5 px-2 py-1">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleSave}
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
    </div>
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

/** Free-form key/value editor for types without an installed plugin manifest. */
function FreeFormOverrides({
  rows,
  onAdd,
  onUpdate,
  onRemove,
}: {
  rows: { key: string; value: string }[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<{ key: string; value: string }>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-zinc-600">user overrides</span>
        <button
          type="button"
          onClick={onAdd}
          className="px-2 py-0.5 text-[11px] text-zinc-400 border border-grid-bounds hover:border-signal-low hover:text-zinc-200 transition-colors"
        >
          + add
        </button>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={row.key}
            onChange={(e) => onUpdate(i, { key: e.target.value })}
            placeholder="key"
            className={`${inputClass} flex-1 font-mono`}
          />
          <input
            value={row.value}
            onChange={(e) => onUpdate(i, { value: e.target.value })}
            placeholder="value"
            className={`${inputClass} flex-1 font-mono`}
          />
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="px-2 text-[11px] text-zinc-600 hover:text-fault-vector transition-colors"
          >
            ✕
          </button>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="text-[11px] text-zinc-600">no overrides configured</p>
      )}
    </div>
  );
}
