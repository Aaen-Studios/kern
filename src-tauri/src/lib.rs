// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
mod config;
mod download;
mod java;
mod manifest;
mod metrics;
mod process;
mod registry;
mod scheduler;
mod scaffold;
mod seed;
mod sync;
mod tray;
mod ui_state;
mod watcher;
mod web_remote;
mod window_state;

use tauri::{Listener, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance must be registered FIRST and only on desktop. On a second
    // launch attempt the callback shows + focuses the existing main window
    // instead of starting a duplicate app.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // OS-login autostart. The `--autostart` arg lets setup distinguish an
        // OS-launched start (which may stay hidden in tray) from a manual one.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(process::ProcessRegistry::default())
        .manage(metrics::MetricsState::default())
        .manage(metrics::MetricsHistory::default())
        .manage(watcher::WatcherState::default())
        .setup(|app| {
            let handle = app.handle().clone();

            // Seed sample community plugins from the repo into AppData so the
            // manifest engine can discover them during development.
            if let Ok(base) = config::config_dir(&handle) {
                seed::seed(&manifest::plugins_dir(&base));
            }

            // Decide initial window visibility.
            //   - OS-login auto-launch (`--autostart`): honor the
            //     `start_hidden_in_tray` setting (default: hidden).
            //   - Manual launch: restore the last remembered visibility from
            //     window.json (so "persist... opened vs tray" holds).
            let autostarted = std::env::args().any(|a| a == "--autostart");
            let settings = config::load_config(&handle).map(|c| c.settings).ok();
            let remember_hidden = window_state::load(&handle).ok().flatten().map(|s| s.hidden);
            let show_window = if autostarted {
                // start_hidden_in_tray defaults to false → show unless opted in.
                settings
                    .as_ref()
                    .map(|s| !s.start_hidden_in_tray)
                    .unwrap_or(true)
            } else {
                // Manual launch: show unless last state was hidden.
                !remember_hidden.unwrap_or(false)
            };

            if let Some(window) = app.get_webview_window("main") {
                // Restore last-saved window geometry before showing.
                if let Ok(Some(state)) = window_state::load(&handle) {
                    window_state::restore(&window, &state);
                }
                if show_window {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            // Install the tray icon + menu, then listen for running-set changes
            // so its "active servers" list + tooltip stay in sync with the
            // process table (process.rs emits on launch + on exit).
            if let Err(e) = tray::setup(&handle) {
                eprintln!("[tray] setup failed: {e}");
            }
            let refresh_handle = handle.clone();
            handle.listen("kern://running-set-changed", move |_event| {
                tray::refresh_menu(&refresh_handle);
            });

            // Auto-start any instances flagged `autoStart`. Non-orphaned only,
            // best-effort per server so one failure doesn't block the rest.
            // Spawned on background threads so a slow start (e.g. a JAR that
            // takes a moment to resolve) can't block setup.
            if let Ok(cfg) = config::load_config(&handle) {
                // ── Reconcile persisted pids against the live process table ──
                // On a previous quit, detach_all left running servers alive in
                // the OS but dropped kern's handles. Each launch persisted its
                // pid; here we sysinfo-probe each and re-adopt live ones as
                // PID-only monitors (liveness + metrics + force-kill; no stdin
                // pipe, so no graceful stop or log streaming for these). Dead
                // pids are cleared so they don't linger.
                let alive_ids = reconcile_adopted(&handle, &cfg);

                // ── Auto-start flagged instances ──
                // Skipped for already-running (owned or re-adopted) instances
                // so we never double-launch into the same port/working dir.
                for server in cfg.servers.values() {
                    if server.auto_start && !server.is_orphaned && !alive_ids.contains(&server.id) {
                        let h = handle.clone();
                        let id = server.id.clone();
                        tauri::async_runtime::spawn(async move {
                            // Tiny delay lets the window/tray finish wiring up
                            // before processes start streaming logs.
                            std::thread::sleep(std::time::Duration::from_millis(200));
                            if let Err(e) = commands::launch_instance(&h, &id) {
                                eprintln!("[autostart] failed to start '{id}': {e}");
                            }
                        });
                    }
                }
            }

            // Spawn the background worker: backup scheduler, health alerts,
            // and metrics-history sampling all run on one 30s loop.
            scheduler::spawn(&handle);

            // Optionally serve the web remote (LAN JSON API) if enabled.
            web_remote::maybe_spawn(&handle);

            Ok(())
        })
        .on_window_event(|window, event| {
            let handle = window.app_handle().clone();
            match event {
                // Close button: always capture geometry first (so the next
                // launch reopens here), then either hide to tray (when
                // close-to-tray is on, the default) or let the real close
                // proceed.
                WindowEvent::CloseRequested { api, .. } => {
                    if let Some(w) = window.get_webview_window("main") {
                        if let Ok(state) = window_state::capture(&w) {
                            let _ = window_state::save(&handle, &state);
                        }
                    }
                    let close_to_tray = config::load_config(&handle)
                        .map(|c| c.settings.close_to_tray)
                        .unwrap_or(true);
                    if close_to_tray {
                        api.prevent_close();
                        if let Some(w) = window.get_webview_window("main") {
                            let _ = w.hide();
                            window_state::set_hidden(&handle, true);
                        }
                        tray::refresh_menu(&handle);
                    } else {
                        // Real close: detach all child processes first, so a
                        // running server isn't abruptly orphaned with its stdin
                        // closed mid-save (only the tray Quit path did this
                        // before). detach_all leaves the processes running but
                        // cleanly disconnects the registry's handles.
                        let registry: tauri::State<'_, process::ProcessRegistry> =
                            handle.state();
                        registry.detach_all();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::get_servers,
            commands::create_server,
            commands::update_server,
            commands::delete_server,
            commands::delete_server_folder,
            commands::refresh_orphaned_status,
            commands::is_server_running,
            commands::launch_server_instance,
            commands::stop_server_instance,
            commands::update_server_status,
            commands::update_app_settings,
            commands::enable_autostart,
            commands::disable_autostart,
            commands::is_autostart_enabled,
            commands::list_running_servers,
            commands::get_instance_metrics,
            commands::get_host_metrics,
            commands::run_lifecycle_step,
            commands::install_server_instance,
            commands::restart_server_instance,
            commands::get_log_tail,
            commands::open_folder,
            commands::write_stdin_to_instance,
            commands::read_env_file,
            commands::server_file_exists,
            commands::write_server_file,
            commands::read_server_file,
            commands::list_server_directory,
            commands::delete_server_path,
            commands::create_server_directory,
            commands::rename_server_path,
            commands::delete_server_path_recursive,
            commands::open_server_path,
            commands::copy_files_to_server,
            commands::list_plugins,
            commands::get_plugin,
            commands::get_plugin_ui_path,
            commands::install_plugin,
            commands::install_plugin_from_kern,
            commands::validate_kern_file,
            commands::create_plugin_package,
            commands::uninstall_plugin,
            commands::run_instance_command,
            commands::search_files,
            commands::get_file_from_backup,
            commands::read_file_bytes,
            download::download_url,
            download::fetch_mc_versions,
            download::resolve_forge_version,
            commands::backup_world,
            commands::list_backups,
            commands::restore_world,
            commands::delete_backup,
            commands::detect_server_jar,
            commands::run_terminal_command,
            commands::update_backup_schedule,
            commands::update_alert_rules,
            commands::get_metrics_history,
            commands::get_instance_energy,
            commands::update_command_snippets,
            commands::get_instance_ports,
            commands::find_replace_in_files,
            registry::registry_list_plugins,
            registry::registry_get_plugin,
            registry::registry_install_plugin,
            sync::sync_export,
            sync::sync_import,
            watcher::watch_server_directory,
            watcher::unwatch_server_directory,
            java::detect_java,
            java::check_java_version,
            java::download_java,
            ui_state::get_ui_state,
            ui_state::set_ui_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Probes each instance's persisted `pid` against the live OS process table and
/// re-adopts still-running ones as PID-only monitors. Returns the set of ids
/// that are now running (owned or adopted) so the auto-start loop can skip them.
///
/// Dead pids are cleared from config so they don't linger. This runs once at
/// startup, before auto-start, so a server still alive from a previous session
/// is recognized rather than double-launched.
fn reconcile_adopted(
    handle: &tauri::AppHandle,
    cfg: &config::AppConfig,
) -> Vec<String> {
    use sysinfo::{Pid, ProcessesToUpdate, System};

    let registry: tauri::State<'_, process::ProcessRegistry> = handle.state();

    // Collect candidate (id, pid) pairs from config.
    let candidates: Vec<(String, u32)> = cfg
        .servers
        .iter()
        .filter_map(|(id, s)| s.pid.map(|p| (id.clone(), p)))
        .collect();

    if candidates.is_empty() {
        return registry.running_ids();
    }

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut alive = Vec::new();
    let mut dead = Vec::new();
    for (id, pid) in candidates {
        if sys.process(Pid::from_u32(pid)).is_some() {
            registry.adopt(handle, &id, pid);
            alive.push(id);
        } else {
            dead.push(id);
        }
    }

    // Clear persisted pids for everything we just reconciled. For alive ones
    // the adopted registry now tracks them in-memory this session; for dead
    // ones the pid is stale. Either way, leaving it would risk a bogus re-adopt.
    let to_clear: Vec<String> = alive.iter().chain(dead.iter()).cloned().collect();
    if !to_clear.is_empty() {
        let clear_handle = handle.clone();
        let _ = config::with_config_mut(&clear_handle, |c| {
            for id in &to_clear {
                if let Some(instance) = c.servers.get_mut(id) {
                    instance.pid = None;
                }
            }
            Ok(())
        });
    }

    // Owned processes (if any launched earlier in setup) + adopted ones.
    registry.running_ids()
}
