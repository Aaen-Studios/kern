// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
mod config;
mod download;
mod java;
mod manifest;
mod metrics;
mod process;
mod scaffold;
mod seed;
mod tray;
mod ui_state;
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
                for server in cfg.servers.values() {
                    if server.auto_start && !server.is_orphaned {
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
            download::download_url,
            download::fetch_mc_versions,
            download::resolve_forge_version,
            commands::backup_world,
            commands::list_backups,
            commands::restore_world,
            commands::delete_backup,
            commands::detect_server_jar,
            java::detect_java,
            java::check_java_version,
            java::download_java,
            ui_state::get_ui_state,
            ui_state::set_ui_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
