import type { SchemaField } from "../../types/manifest";

/**
 * Dynamic form engine — generates a configuration screen from a plugin's
 * configSchema.
 *
 * Spec: documentation/ArchitecturePlan.md §4 (Dynamic Form Engine). The host
 * renders one input per schema field, seeding each with its default and
 * surfacing changes through a single onChange callback. This replaces the
 * free-form override editor in ServerForm once a plugin manifest is selected.
 */
interface DynamicFormProps {
  schema: SchemaField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

export function DynamicForm({ schema, values, onChange }: DynamicFormProps) {
  if (schema.length === 0) {
    return (
      <p className="text-[11px] text-zinc-600">
        this plugin has no configurable fields
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {schema.map((field) => (
        <label key={field.key} className="block">
          <span className="block mb-1 text-[10px] tracking-[0.2em] uppercase text-zinc-500">
            {field.label}
          </span>
          {field.type === "select" && field.options ? (
            <select
              value={values[field.key] ?? field.default}
              onChange={(e) => onChange(field.key, e.target.value)}
              className={inputClass}
            >
              {field.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={values[field.key] ?? field.default}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.default}
              className={`${inputClass} font-mono`}
            />
          )}
        </label>
      ))}
    </div>
  );
}

const inputClass =
  "w-full bg-bg-core border border-grid-bounds px-2 py-1.5 text-xs text-zinc-200 focus:border-signal-low transition-colors";
