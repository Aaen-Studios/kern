//! Global config.json registry: persistence + orphaned-state detection.
//!
//! Spec: documentation/ArchitecturePlan.md §2 (Core Registry Schema).
//! The config document lives at `<app_data_dir>/config.json` and tracks every
//! server instance. If an instance's path is no longer accessible, the core
//! marks it `is_orphaned` rather than deleting it.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Config schema version. Bumped on incompatible document changes.
pub const CONFIG_VERSION: &str = "2.0.0";

/// Root config.json document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: String,
    pub settings: AppSettings,
    pub servers: HashMap<String, ServerInstance>,
}

/// Global application settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_sandbox_path: String,
    /// Launch kern automatically when the user signs in to the OS.
    /// Mirrors the OS-level autostart registration (kept in sync by the
    /// enable/disable commands) so the UI reflects the persisted intent even
    /// before the OS entry is (de)registered.
    #[serde(default)]
    pub launch_on_login: bool,
    /// When true, the window close button (×) hides the window to the tray
    /// instead of quitting; real exit happens via the tray menu. Defaults to
    /// true so the app behaves as a long-running host by default.
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    /// When kern is launched by the OS at login, start hidden in the tray
    /// rather than showing the window. Manual launches always restore the
    /// last remembered window visibility.
    #[serde(default)]
    pub start_hidden_in_tray: bool,
}

/// Serde default helper — emits `true`. Used for opt-in booleans that should
/// default on (e.g. `close_to_tray`) so existing config.json documents
/// without the field pick up the new behavior automatically.
fn default_true() -> bool {
    true
}

/// A tracked server instance.
///
/// Field names are camelCase on the wire to match the TS contracts in
/// `src/types/server.ts` and the documented config.json schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInstance {
    pub id: String,
    pub name: String,
    pub server_type: String,
    pub path: String,
    pub status: String,
    pub is_orphaned: bool,
    pub user_overrides: HashMap<String, String>,
    /// When true, this instance is launched automatically as kern starts —
    /// either on manual app launch or on OS-login auto-startup. Backed by a
    /// per-instance toggle in the UI (detail header + create/edit form).
    #[serde(default)]
    pub auto_start: bool,
}

/// Returns the on-disk directory that holds config.json (and later plugins/).
/// The directory is created on first access.
pub fn config_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create app data dir '{}': {e}", dir.display()))?;
    }
    Ok(dir)
}

/// Absolute path to config.json.
pub fn config_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app_handle)?.join("config.json"))
}

/// Builds the default empty config document.
///
/// `default_sandbox_path` points at `<app_data_dir>/servers` — the location
/// used when a user does not pick a custom path for an instance.
fn default_config(app_handle: &AppHandle) -> Result<AppConfig, String> {
    let sandbox = config_dir(app_handle)?.join("servers");
    Ok(AppConfig {
        version: CONFIG_VERSION.to_string(),
        settings: AppSettings {
            default_sandbox_path: sandbox.to_string_lossy().to_string(),
            launch_on_login: false,
            close_to_tray: true,
            start_hidden_in_tray: false,
        },
        servers: HashMap::new(),
    })
}

/// Loads config.json, creating it with defaults if missing.
///
/// After loading, every server instance is re-checked for orphaned status
/// (ArchitecturePlan §2: "If an instance's path becomes inaccessible, the core
/// marks it as orphaned instead of deleting it").
pub fn load_config(app_handle: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app_handle)?;

    let mut config = if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read '{}': {e}", path.display()))?;
        if raw.trim().is_empty() {
            default_config(app_handle)?
        } else {
            serde_json::from_str::<AppConfig>(&raw).map_err(|e| {
                format!("failed to parse '{}': {e}", path.display())
            })?
        }
    } else {
        // First run — seed a fresh document and persist it.
        let config = default_config(app_handle)?;
        save_config(app_handle, &config)?;
        config
    };

    refresh_orphaned(&mut config);
    Ok(config)
}

/// Writes config.json atomically. Writes to a sibling temp file first, then
/// renames — so a crash mid-write cannot corrupt the registry.
pub fn save_config(app_handle: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app_handle)?;
    let raw = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, raw).map_err(|e| format!("failed to write '{}': {e}", tmp.display()))?;
    fs::rename(&tmp, &path)
        .map_err(|e| format!("failed to commit '{}': {e}", path.display()))?;
    Ok(())
}

/// Recomputes `is_orphaned` for every instance in place.
pub fn refresh_orphaned(config: &mut AppConfig) {
    for server in config.servers.values_mut() {
        server.is_orphaned = !Path::new(&server.path).exists();
    }
}

/// Generates a stable instance id, e.g. `srv_9f82b1a0`.
pub fn generate_id() -> String {
    // 4 bytes of pseudo-randomness rendered as hex is enough collision-resistance
    // for a single-user panel and avoids pulling a uuid crate in Phase 1.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9f82b1a0);
    // Mix the timestamp through an xorshift to spread bits across the hex output.
    let mut x = now.wrapping_mul(0x9e3779b97f4a7c15).max(1);
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    format!("srv_{x:08x}")
}
