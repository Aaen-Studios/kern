//! Running-process registry + variable resolution.
//!
//! Spec: documentation/ArchitecturePlan.md §5 (Backend Architecture).
//! Holds the live child handles spawned by the shell plugin so a stop command
//! can terminate them, and resolves `{{userOverrides.*}}` template variables
//! from a plugin manifest's lifecycle step before spawning.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Structured status payload emitted on `status:<id>` — the UI can switch on
/// `state` rather than parsing a free-form string.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StatusPayload {
    /// Process spawned and now streaming output.
    Running,
    /// Process terminated, optionally with an exit code.
    Exited { code: Option<i32> },
}

/// One entry per running instance: the spawned child (for kill) and the path
/// to its working directory (for the log file).
struct RunningProcess {
    child: CommandChild,
    #[allow(dead_code)]
    working_dir: PathBuf,
}

/// Global process table, keyed by server instance id.
#[derive(Default)]
pub struct ProcessRegistry {
    processes: Mutex<HashMap<String, RunningProcess>>,
}

/// Resolves `{{userOverrides.<key>}}` placeholders in a template string.
///
/// Mirrors the contract documented in ArchitecturePlan §5.
pub fn resolve_variables(template: &str, variables: &HashMap<String, String>) -> String {
    let mut out = template.to_string();
    for (key, val) in variables {
        let pattern = format!("{{{{userOverrides.{}}}}}", key);
        out = out.replace(&pattern, val);
    }
    out
}

/// Formats the current wall-clock time as `[HH:MM:SS]` for log prefixes.
fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let day = secs / 86_400;
    let mut tod = secs % 86_400; // seconds since local midnight (UTC)
    // Local timezone offset isn't worth a dependency; normalize to a 24h cycle.
    let _ = day;
    let h = (tod / 3600) % 24;
    tod %= 3600;
    let m = (tod / 60) % 60;
    let s = tod % 60;
    format!("[{h:02}:{m:02}:{s:02}]")
}

/// Writes a line to the instance's latest.log, prefixed with a timestamp.
fn append_log(log_path: &Path, bytes: &[u8]) {
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) else {
        return;
    };
    let _ = file.write_all(timestamp().as_bytes());
    let _ = file.write_all(b" ");
    let _ = file.write_all(bytes);
    if bytes.last() != Some(&b'\n') {
        let _ = file.write_all(b"\n");
    }
}

/// Spawns a server instance's "start" lifecycle step.
///
/// `working_dir` is where the process runs and where `latest.log` is written.
/// On success the process is registered, its output is streamed over
/// `log:<id>:stream`, and a `Running` status is emitted. When it exits, an
/// `Exited` status is emitted and the handle is dropped.
pub fn launch(
    app_handle: &AppHandle,
    instance_id: &str,
    working_dir: &Path,
    command: &str,
    args: &[String],
) -> Result<(), String> {
    // 1. Spawn the process via the Tauri Shell plugin.
    let (mut rx, child) = app_handle
        .shell()
        .command(command)
        .args(args)
        .current_dir(working_dir.to_path_buf())
        .spawn()
        .map_err(|e| format!("failed to spawn '{command}': {e}"))?;

    // 2. Register the child so stop_server_instance can terminate it.
    let registry: tauri::State<'_, ProcessRegistry> = app_handle.state();
    {
        let mut map = registry
            .processes
            .lock()
            .map_err(|e| format!("process registry lock poisoned: {e}"))?;
        map.insert(
            instance_id.to_string(),
            RunningProcess {
                child,
                working_dir: working_dir.to_path_buf(),
            },
        );
    }

    // 3. Notify the UI the process is now running.
    let _ = app_handle.emit(
        &format!("status:{instance_id}"),
        StatusPayload::Running,
    );

    // 4. Background loop: capture stdout/stderr → disk + stream to the UI.
    let event_name = format!("log:{instance_id}:stream");
    let status_event = format!("status:{instance_id}");
    let log_path = working_dir.join("latest.log");
    let id = instance_id.to_string();
    // Clone to an owned handle — the reference can't move into the 'static task.
    let task_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                // Only forward stdout to the UI stream. Stderr is still persisted
                // to disk (below) but not emitted — many runtimes mirror the same
                // output onto both streams, which caused every line to render twice.
                CommandEvent::Stdout(bytes) => {
                    append_log(&log_path, &bytes);
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    // Prefix with a wall-clock timestamp so every line in the UI
                    // carries one — matches the format already written to disk.
                    let stamped = format!("{} {}", timestamp(), line);
                    let _ = task_handle.emit(&event_name, stamped);
                }
                CommandEvent::Stderr(bytes) => {
                    // Persist stderr to latest.log for debugging, but don't stream
                    // it to the UI (avoids duplicate lines on runtimes that echo
                    // stdout onto stderr).
                    append_log(&log_path, &bytes);
                }
                CommandEvent::Terminated(payload) => {
                    // Process exited — drop our handle and notify the UI.
                    let registry: tauri::State<'_, ProcessRegistry> = task_handle.state();
                    if let Ok(mut map) = registry.processes.lock() {
                        map.remove(&id);
                    }
                    let payload = StatusPayload::Exited { code: payload.code };
                    let _ = task_handle.emit(&status_event, payload.clone());
                    let label = match payload {
                        StatusPayload::Exited { code: Some(c) } => format!("exit {c}"),
                        _ => "no exit code".to_string(),
                    };
                    let _ = task_handle.emit(
                        &event_name,
                        format!("{} [process terminated ({})]", timestamp(), label),
                    );
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Terminates a running instance by id. Returns Ok even if not running, so the
/// UI can treat stop as idempotent.
pub fn stop(app_handle: &AppHandle, instance_id: &str) -> Result<(), String> {
    let registry: tauri::State<'_, ProcessRegistry> = app_handle.state();
    let removed = {
        let mut map = registry
            .processes
            .lock()
            .map_err(|e| format!("process registry lock poisoned: {e}"))?;
        map.remove(instance_id)
    };
    if let Some(proc) = removed {
        proc.child
            .kill()
            .map_err(|e| format!("failed to kill '{instance_id}': {e}"))?;
    }
    Ok(())
}

/// Writes bytes to a running instance's stdin stream.
///
/// Returns an error if the instance is not currently tracked as running, or if
/// the write itself fails (e.g. the child's stdin pipe was closed).
pub fn write_stdin(
    app_handle: &AppHandle,
    instance_id: &str,
    data: &str,
) -> Result<(), String> {
    let registry: tauri::State<'_, ProcessRegistry> = app_handle.state();
    let mut map = registry
        .processes
        .lock()
        .map_err(|e| format!("process registry lock poisoned: {e}"))?;
    let proc = map
        .get_mut(instance_id)
        .ok_or_else(|| format!("instance '{instance_id}' is not running"))?;
    proc.child
        .write(data.as_bytes())
        .map_err(|e| format!("failed to write stdin to '{instance_id}': {e}"))?;
    Ok(())
}

/// Whether an instance currently has a tracked running process.
pub fn is_running(app_handle: &AppHandle, instance_id: &str) -> bool {
    let registry: tauri::State<'_, ProcessRegistry> = app_handle.state();
    registry
        .processes
        .lock()
        .map(|m| m.contains_key(instance_id))
        .unwrap_or(false)
}
