// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
mod config;
mod window_state;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Restore last-saved window geometry before the window is shown.
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(state)) = window_state::load(app.handle()) {
                    window_state::restore(&window, &state);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Persist window geometry on close so the next launch reopens here.
            if let WindowEvent::CloseRequested { .. } = event {
                if let Some(window) = window.get_webview_window("main") {
                    if let Ok(state) = window_state::capture(&window) {
                        let _ = window_state::save(window.app_handle(), &state);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::get_servers,
            commands::create_server,
            commands::update_server,
            commands::delete_server,
            commands::refresh_orphaned_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
