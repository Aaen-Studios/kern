//! Filesystem watcher — emits a Tauri event whenever a watched instance
//! directory changes, so the frontend file explorer can refresh in real time.
//!
//! Uses `notify-debouncer-mini` so a burst of writes from a running server
//! process collapses into a single coalesced event (otherwise a log append
//! would spam dozens of refreshes per second).
//!
//! Each instance root is watched recursively. The debouncer is shared across
//! all watched instances; we track which absolute paths are active so an
//! unwatch cleanly removes just that instance's watch. Events carry the
//! (possibly non-existent) path of the entry that changed, and the frontend
//! matches it against the server it cares about.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use notify_debouncer_mini::{new_debouncer, DebouncedEvent, notify::RecommendedWatcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri::command;

/// Global event name emitted on any watched filesystem change.
pub const FS_CHANGED_EVENT: &str = "server://fs-changed";

/// Payload for [`FS_CHANGED_EVENT`].
#[derive(Clone, Serialize)]
struct FsChanged {
    /// Absolute path of the file/dir that changed (best-effort from notify).
    path: String,
}

/// Holds the shared debouncer and the set of currently-watched instance roots.
///
/// The debouncer owns its background thread; we keep it behind an `Option` so
/// it can be lazily started on the first `watch` call. `Mutex` serializes
/// add/remove so two panels mounting at once can't race the watcher.
pub struct WatcherState {
    debouncer: Mutex<Option<notify_debouncer_mini::Debouncer<RecommendedWatcher>>>,
    watched: Mutex<HashSet<PathBuf>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            debouncer: Mutex::new(None),
            watched: Mutex::new(HashSet::new()),
        }
    }
}

/// Lazily creates the debouncer (if absent) and adds a recursive watch on the
/// instance root. Idempotent: re-watching an already-watched path is a no-op.
#[command]
pub fn watch_server_directory(
    app_handle: AppHandle,
    state: State<'_, WatcherState>,
    id: String,
) -> Result<(), String> {
    let cfg = crate::config::load_config(&app_handle)?;
    let instance = cfg
        .servers
        .get(&id)
        .ok_or_else(|| format!("server '{id}' not found"))?;
    let root = PathBuf::from(&instance.path);

    // Ensure the directory exists — notify can't watch a missing path. This
    // mirrors create_server, but the directory may have been removed since.
    if !root.exists() {
        std::fs::create_dir_all(&root)
            .map_err(|e| format!("failed to create instance directory '{}': {e}", root.display()))?;
    }

    let handle = app_handle.clone();

    // Lazily initialise the debouncer on first use. The callback coalesces a
    // burst of events into one emit per debounce window.
    let mut debouncer_guard = state.debouncer.lock().map_err(|e| format!("watcher lock poisoned: {e}"))?;
    if debouncer_guard.is_none() {
        let app_for_cb = handle.clone();
        let debouncer = new_debouncer(
            std::time::Duration::from_millis(300),
            move |res: Result<Vec<DebouncedEvent>, _>| {
                let Ok(events) = res else { return };
                if events.is_empty() { return }
                // Emit once per debounced batch — the frontend ignores the
                // specific path and just refreshes, so a single event suffices.
                // We still send the first changed path for context/debugging.
                let path = events
                    .first()
                    .and_then(|e| e.path.to_str())
                    .unwrap_or("")
                    .to_string();
                let _ = app_for_cb.emit(FS_CHANGED_EVENT, FsChanged { path });
            },
        )
        .map_err(|e| format!("failed to create watcher: {e}"))?;
        *debouncer_guard = Some(debouncer);
    }

    let mut watched = state.watched.lock().map_err(|e| format!("watcher lock poisoned: {e}"))?;
    if watched.contains(&root) {
        return Ok(());
    }

    let debouncer = debouncer_guard
        .as_mut()
        .ok_or_else(|| "watcher not initialised".to_string())?;
    debouncer
        .watcher()
        .watch(&root, notify::RecursiveMode::Recursive)
        .map_err(|e| format!("failed to watch '{}': {e}", root.display()))?;
    watched.insert(root);

    Ok(())
}

/// Removes the watch for the given instance root. No-op if it wasn't watched
/// (e.g. the directory was already deleted).
#[command]
pub fn unwatch_server_directory(
    app_handle: AppHandle,
    state: State<'_, WatcherState>,
    id: String,
) -> Result<(), String> {
    let cfg = crate::config::load_config(&app_handle)?;
    let instance = cfg
        .servers
        .get(&id)
        .ok_or_else(|| format!("server '{id} not found"))?;
    let root = PathBuf::from(&instance.path);

    let mut watched = state.watched.lock().map_err(|e| format!("watcher lock poisoned: {e}"))?;
    if !watched.remove(&root) {
        return Ok(()); // wasn't being watched — nothing to do
    }

    let mut debouncer_guard = state.debouncer.lock().map_err(|e| format!("watcher lock poisoned: {e}"))?;
    if let Some(debouncer) = debouncer_guard.as_mut() {
        let _ = debouncer.watcher().unwatch(&root);
    }

    Ok(())
}
