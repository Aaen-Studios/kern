//! Plugin marketplace client — talks to the kern-web registry (Supabase-backed
//! Next.js API). All read endpoints are public (no auth).
//!
//! The desktop app lists/searches plugins via GET /api/plugins, fetches detail
//! via GET /api/plugins/:slug, and installs by downloading the .kern via
//! GET /api/download (a 302 to a signed Supabase URL) then handing the local
//! file to the existing `install_plugin_from_kern` command.
//!
//! Base URL comes from `AppSettings.registry_url` (default: live site).

use std::io::Read;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::config;
use crate::manifest;

/// The marketplace plugin row.
///
/// The kern-web API returns snake_case keys (the raw Supabase shape:
/// `display_name`, `install_count`, `kern_compat`, …), so we **deserialize**
/// in snake_case. The frontend TS contract is camelCase, so we **serialize**
/// in camelCase. serde's split `rename_all(deserialize/serialize)` handles
/// both directions without a second struct.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct RegistryPlugin {
    pub id: String,
    pub slug: String,
    pub display_name: String,
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub upvotes: i64,
    #[serde(default)]
    pub install_count: i64,
    #[serde(default)]
    pub featured: bool,
    #[serde(default)]
    pub author_github: Option<String>,
    #[serde(default)]
    pub author_avatar: Option<String>,
    #[serde(default)]
    pub repo_url: Option<String>,
    #[serde(default)]
    pub homepage_url: Option<String>,
    #[serde(default)]
    pub versions: Vec<RegistryVersion>,
}

/// A downloadable version of a registry plugin (snake_case from the API).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct RegistryVersion {
    pub version: String,
    #[serde(default)]
    pub kern_compat: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size_bytes: i64,
    #[serde(default)]
    pub changelog: Option<String>,
}

/// Resolves the registry base URL from settings (trailing slash trimmed).
fn base_url(app_handle: &AppHandle) -> String {
    let cfg = config::load_config(app_handle);
    let url = cfg
        .ok()
        .map(|c| c.settings.registry_url)
        .unwrap_or_else(|| "https://kern.aaenz.no".to_string());
    url.trim_end_matches('/').to_string()
}

/// GET /api/plugins — list + optional search/filter.
#[tauri::command]
pub fn registry_list_plugins(
    app_handle: AppHandle,
    q: Option<String>,
    category: Option<String>,
    sort: Option<String>,
) -> Result<Vec<RegistryPlugin>, String> {
    let base = base_url(&app_handle);
    let mut url = format!("{base}/api/plugins");
    let mut params: Vec<String> = Vec::new();
    if let Some(q) = q.filter(|s| !s.trim().is_empty()) {
        params.push(format!("q={}", urlenc(&q)));
    }
    if let Some(c) = category.filter(|s| !s.trim().is_empty()) {
        params.push(format!("category={}", urlenc(&c)));
    }
    if let Some(s) = sort.filter(|s| !s.trim().is_empty()) {
        params.push(format!("sort={}", urlenc(&s)));
    }
    if !params.is_empty() {
        url.push('?');
        url.push_str(&params.join("&"));
    }
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("registry request failed: {e}"))?;
    let body = resp.into_body();
    let mut text = String::new();
    body.into_reader()
        .read_to_string(&mut text)
        .map_err(|e| format!("failed to read registry response: {e}"))?;
    let plugins: Vec<RegistryPlugin> = serde_json::from_str(&text)
        .map_err(|e| format!("failed to parse plugin list: {e}"))?;
    Ok(plugins)
}

/// GET /api/plugins/:slug — single plugin detail.
#[tauri::command]
pub fn registry_get_plugin(
    app_handle: AppHandle,
    slug: String,
) -> Result<RegistryPlugin, String> {
    let base = base_url(&app_handle);
    let url = format!("{base}/api/plugins/{}", urlenc(&slug));
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("registry request failed: {e}"))?;
    let body = resp.into_body();
    let mut text = String::new();
    body.into_reader()
        .read_to_string(&mut text)
        .map_err(|e| format!("failed to read registry response: {e}"))?;
    let plugin: RegistryPlugin = serde_json::from_str(&text)
        .map_err(|e| format!("failed to parse plugin: {e}"))?;
    Ok(plugin)
}

/// Downloads a plugin version from the registry and installs it.
///
/// Flow: GET /api/download?id=&v= (302 → signed Supabase URL) → stream to a
/// temp file → hand to `install_plugin_from_kern` with force=true (upgrade).
/// Emits `download:{progress_id}:progress` during the download so the UI can
/// show a progress bar, mirroring `download::download_url`.
#[tauri::command]
pub fn registry_install_plugin(
    app_handle: AppHandle,
    slug: String,
    version: String,
    progress_id: String,
) -> Result<manifest::Manifest, String> {
    use crate::commands;

    let base = base_url(&app_handle);
    let download_url = format!(
        "{base}/api/download?id={}&v={}",
        urlenc(&slug),
        urlenc(&version)
    );

    // Stream to a temp .kern file, following the 302 redirect (ureq follows by default).
    let temp_dir = tempfile::tempdir()
        .map_err(|e| format!("failed to create temp dir: {e}"))?;
    let dest = temp_dir.path().join(format!("{slug}-{version}.kern"));

    let resp = ureq::get(&download_url)
        .call()
        .map_err(|e| format!("download request failed: {e}"))?;
    let total = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    let mut file = std::fs::File::create(&dest)
        .map_err(|e| format!("failed to create temp file: {e}"))?;
    let mut reader = resp.into_body().into_reader();
    let mut buf = [0u8; 8192];
    let mut bytes: u64 = 0;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("download read failed: {e}"))?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buf[..n])
            .map_err(|e| format!("temp write failed: {e}"))?;
        bytes += n as u64;
        let _ = app_handle.emit(
            &format!("download:{progress_id}:progress"),
            serde_json::json!({ "bytes": bytes, "total": total }),
        );
    }
    drop(file);

    // Install the downloaded package, then bump the registry install counter.
    let manifest =
        commands::install_plugin_from_kern(app_handle.clone(), dest.to_string_lossy().to_string(), true)?;

    // Fire-and-forget the install-counter bump (best-effort, ignore failure).
    let h = app_handle.clone();
    let s = slug.clone();
    std::thread::spawn(move || {
        let url = format!("{}/api/plugins/{}/install", base_url(&h), urlenc(&s));
        let _ = ureq::post(&url).send_empty();
    });

    // Temp dir cleans up when temp_dir drops — but install copied the files
    // out already, so that's fine.
    drop(temp_dir);
    Ok(manifest)
}

/// Minimal URL-component encoder (the bits we emit are slugs/versions, but
/// be safe against spaces and reserved chars).
fn urlenc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}
