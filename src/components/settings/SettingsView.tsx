import { useState } from "react";
import { useSettings } from "../../hooks/useSettings";

interface SettingsViewProps {
  /** Called when the user wants to go back to the server list. */
  onBack: () => void;
}

/**
 * App-level settings view: OS-login autostart, tray/minimize behavior.
 *
 * Follows the same header + content layout as PluginManager / ServerDetailView.
 * Settings load via `useSettings` (which reads `get_config().settings`) and
 * persist via `update_app_settings`; the autostart toggle additionally
 * (de)registers the OS entry so it never drifts from the persisted flag.
 */
export function SettingsView({ onBack }: SettingsViewProps) {
  const { settings, loading, error, update, setLaunchOnLogin } = useSettings();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleAutostart(enabled: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      await setLaunchOnLogin(enabled);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSetting(key: "closeToTray" | "startHiddenInTray", value: boolean) {
    if (!settings) return;
    setActionError(null);
    try {
      await update({ [key]: value } as Partial<typeof settings>);
    } catch (e) {
      setActionError(String(e));
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="border-b border-grid-bounds p-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="text-[18px] text-zinc-500 hover:text-zinc-200 transition-colors mr-1"
          >
            ←
          </button>
          <div className="min-w-0">
            <h2 className="text-sm text-zinc-100">settings</h2>
            <p className="text-[11px] text-zinc-500 font-mono truncate">
              {loading ? "loading…" : "host + startup preferences"}
            </p>
          </div>
        </div>
      </div>

      {(error || actionError) && (
        <p className="m-4 text-[11px] text-fault-vector border border-fault-vector/40 bg-fault-vector/5 px-2 py-1">
          {actionError ?? error}
        </p>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[11px] text-zinc-600">loading settings…</p>
        </div>
      )}

      {!loading && settings && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl p-4 space-y-6">
            {/* ── Startup section ─────────────────────────────────────── */}
            <section>
              <h3 className="text-[10px] tracking-[0.2em] uppercase text-zinc-500 mb-3">
                startup
              </h3>
              <div className="space-y-1 border border-grid-bounds">
                <ToggleRow
                  label="Launch kern when my computer starts"
                  description="Register kern as an OS-login launch item. When it starts this way it can stay hidden in the tray (below)."
                  checked={settings.launchOnLogin}
                  disabled={busy}
                  onChange={handleAutostart}
                />
                <Divider />
                <ToggleRow
                  label="Start hidden in the tray on auto-launch"
                  description="When the OS starts kern at login, keep it in the tray without showing the window. Manual launches always restore the last window state."
                  checked={settings.startHiddenInTray}
                  onChange={(v) => void handleSetting("startHiddenInTray", v)}
                />
              </div>
            </section>

            {/* ── Tray section ───────────────────────────────────────── */}
            <section>
              <h3 className="text-[10px] tracking-[0.2em] uppercase text-zinc-500 mb-3">
                tray
              </h3>
              <div className="space-y-1 border border-grid-bounds">
                <ToggleRow
                  label="Keep kern running in the tray when closed"
                  description="Closing the window hides it to the tray instead of quitting; servers keep running. Use the tray menu's Quit to fully exit."
                  checked={settings.closeToTray}
                  onChange={(v) => void handleSetting("closeToTray", v)}
                />
              </div>
              <p className="mt-2 text-[11px] text-zinc-600">
                The tray icon lists every active server so you can jump straight
                to one. Left-click toggles the window.
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Toggle row ───────────────────────────────────────────────────────── */

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: ToggleRowProps) {
  return (
    <label
      className={`flex items-start justify-between gap-4 px-3 py-3 bg-bg-surface ${
        disabled ? "opacity-50" : "hover:bg-bg-core"
      } transition-colors cursor-pointer`}
    >
      <div className="min-w-0">
        <div className="text-xs text-zinc-200">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] text-zinc-500 leading-snug">
            {description}
          </div>
        )}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

function Divider() {
  return <div className="h-px bg-grid-bounds mx-3" />;
}

/* ─── Switch control ──────────────────────────────────────────────────── */

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onChange(!checked);
      }}
      className={`relative shrink-0 w-8 h-4 border transition-colors ${
        checked
          ? "bg-signal-high/30 border-signal-high"
          : "bg-bg-core border-grid-bounds"
      } ${disabled ? "cursor-not-allowed" : ""}`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 transition-all ${
          checked
            ? "right-0.5 bg-signal-high"
            : "left-0.5 bg-zinc-500"
        }`}
      />
    </button>
  );
}
