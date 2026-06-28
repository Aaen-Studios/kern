//! Tauri commands exposing the server registry CRUD.
//!
//! Spec: documentation/ArchitecturePlan.md §2 (Phase 1 — standard CRUD
//! operations via Rust file commands, plus orphaned-state handling).

use std::collections::HashMap;

use tauri::AppHandle;

use crate::config::{self, AppConfig, ServerInstance};

/// Returns the full config document, with `is_orphaned` refreshed on read.
#[tauri::command]
pub fn get_config(app_handle: AppHandle) -> Result<AppConfig, String> {
    config::load_config(&app_handle)
}

/// Returns just the tracked server instances as a list.
#[tauri::command]
pub fn get_servers(app_handle: AppHandle) -> Result<Vec<ServerInstance>, String> {
    let cfg = config::load_config(&app_handle)?;
    Ok(cfg.servers.into_values().collect())
}

/// Input accepted by `create_server`. Fields the host owns (`id`, `status`,
/// `is_orphaned`) are filled in server-side.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewServerInput {
    pub name: String,
    pub server_type: String,
    pub path: String,
    #[serde(default)]
    pub user_overrides: HashMap<String, String>,
}

/// Creates a new server instance and returns the persisted record (with its
/// generated id and resolved orphaned status).
#[tauri::command]
pub fn create_server(
    app_handle: AppHandle,
    input: NewServerInput,
) -> Result<ServerInstance, String> {
    let mut cfg = config::load_config(&app_handle)?;

    let instance = ServerInstance {
        id: config::generate_id(),
        name: input.name,
        server_type: input.server_type,
        path: input.path,
        status: "stopped".to_string(),
        is_orphaned: false,
        user_overrides: input.user_overrides,
    };

    cfg.servers.insert(instance.id.clone(), instance.clone());
    config::save_config(&app_handle, &cfg)?;
    Ok(instance)
}

/// Updates an existing instance by id. Returns an error if the id is unknown.
#[tauri::command]
pub fn update_server(
    app_handle: AppHandle,
    server: ServerInstance,
) -> Result<ServerInstance, String> {
    let mut cfg = config::load_config(&app_handle)?;

    let updated = {
        let entry = cfg
            .servers
            .get_mut(&server.id)
            .ok_or_else(|| format!("server '{}' not found", server.id))?;
        entry.name = server.name;
        entry.server_type = server.server_type;
        entry.path = server.path;
        // Status is host-owned, so we keep whatever the caller sent (Phase 2
        // will drive it from the shell lifecycle).
        entry.status = server.status;
        entry.user_overrides = server.user_overrides;
        entry.is_orphaned = server.is_orphaned;
        entry.clone()
    };

    config::save_config(&app_handle, &cfg)?;
    Ok(updated)
}

/// Deletes an instance by id. Missing ids are treated as already-deleted (Ok).
#[tauri::command]
pub fn delete_server(app_handle: AppHandle, id: String) -> Result<(), String> {
    let mut cfg = config::load_config(&app_handle)?;
    cfg.servers.remove(&id);
    config::save_config(&app_handle, &cfg)?;
    Ok(())
}

/// Re-checks every instance's path on disk and returns the refreshed list.
#[tauri::command]
pub fn refresh_orphaned_status(
    app_handle: AppHandle,
) -> Result<Vec<ServerInstance>, String> {
    let mut cfg = config::load_config(&app_handle)?;
    config::refresh_orphaned(&mut cfg);
    config::save_config(&app_handle, &cfg)?;
    Ok(cfg.servers.into_values().collect())
}
