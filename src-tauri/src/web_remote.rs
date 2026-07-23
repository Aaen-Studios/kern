//! Optional web remote — a tiny HTTP server that exposes the panel as a
//! read-mostly JSON API a phone (or anything on the LAN) can hit.
//!
//! Re-serving the full React frontend over plain HTTP doesn't work well — it
//! relies on webview-only Tauri APIs (invoke, asset://). Instead we expose a
//! small, passphrase-protected REST surface: list servers, status, start/stop,
//! tail logs, push stdin. Same backend the desktop UI uses; a phone-friendly
//! page can be built against this later (or any HTTP client used directly).
//!
//! Enabled by AppSettings.web_remote_enabled; bound to 0.0.0.0:<port> (LAN)
//! when on, off entirely otherwise. Auth: a bearer passphrase compared in
//! constant time, or none if the passphrase is empty (LAN-only trust).

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use tauri::AppHandle;

use crate::config;
use crate::process;

/// The port the web remote listens on (LAN-wide).
pub const WEB_REMOTE_PORT: u16 = 7440;

/// Spawns the web remote server if enabled in settings. No-op otherwise.
/// Runs for the app lifetime on its own thread; each connection is handled on
/// a fresh thread so a slow client can't block others.
pub fn maybe_spawn(app_handle: &AppHandle) {
    let enabled = config::load_config(app_handle)
        .map(|c| c.settings.web_remote_enabled)
        .unwrap_or(false);
    if !enabled {
        return;
    }
    let handle = app_handle.clone();
    std::thread::spawn(move || serve(&handle));
}

/// Binds and serves until the app exits.
fn serve(handle: &AppHandle) {
    let listener = match TcpListener::bind(("0.0.0.0", WEB_REMOTE_PORT)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[web-remote] failed to bind :{WEB_REMOTE_PORT}: {e}");
            return;
        }
    };
    eprintln!("[web-remote] listening on 0.0.0.0:{WEB_REMOTE_PORT}");
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .ok();
        let h = handle.clone();
        std::thread::spawn(move || {
            let _ = handle_conn(&h, stream);
        });
    }
}

/// Handles one HTTP/1.0-ish request. Tiny hand-rolled parser — good enough for
/// a local control API; we don't need a full framework here.
fn handle_conn(handle: &AppHandle, mut stream: TcpStream) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;

    // Read headers (we only need Authorization).
    let mut auth: Option<String> = None;
    loop {
        let mut header = String::new();
        let n = reader.read_line(&mut header)?;
        if n == 0 || header == "\r\n" || header == "\n" {
            break;
        }
        if header.to_ascii_lowercase().starts_with("authorization:") {
            auth = header
                .split(':')
                .nth(1)
                .map(|v| v.trim().to_string());
        }
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    let method = parts.first().copied().unwrap_or("");
    let path = parts.get(1).copied().unwrap_or("");

    // Auth check.
    if !check_auth(handle, auth.as_deref()) {
        return respond(
            &mut stream,
            401,
            "application/json",
            r#"{"error":"unauthorized","hint":"send Authorization: Bearer <passphrase>"}"#,
        );
    }

    let (status, body) = route(handle, method, path);
    respond(&mut stream, status, "application/json", &body)
}

/// Constant-time-ish passphrase comparison (not cryptographic, but avoids the
/// obvious early-return timing leak). Empty configured passphrase = open access.
fn check_auth(handle: &AppHandle, provided: Option<&str>) -> bool {
    let cfg = match config::load_config(handle) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let expected = cfg.settings.web_remote_passphrase.trim();
    if expected.is_empty() {
        return true; // no passphrase configured = open (LAN-only trust)
    }
    match provided {
        Some(p) => {
            let token = p.strip_prefix("Bearer ").unwrap_or(p).trim();
            constant_eq(token.as_bytes(), expected.as_bytes())
        }
        None => false,
    }
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Routes a request to the right backend call. Returns (status, json_body).
fn route(handle: &AppHandle, method: &str, path: &str) -> (u16, String) {
    // Strip query string.
    let path = path.split('?').next().unwrap_or(path);
    let segs: Vec<&str> = path.trim_start_matches('/').split('/').collect();

    match (method, segs.as_slice()) {
        ("GET", ["health"]) => (200, ok(r#"{"status":"ok"}"#)),
        ("GET", ["servers"]) => {
            let cfg = match config::load_config(handle) {
                Ok(c) => c,
                Err(e) => return (500, err(&e)),
            };
            let mut out = Vec::new();
            for (id, s) in &cfg.servers {
                let running = process::is_running(handle, id);
                let pid = process::pid_for(handle, id).unwrap_or(0);
                out.push(serde_json::json!({
                    "id": id,
                    "name": s.name,
                    "type": s.server_type,
                    "status": s.status,
                    "running": running,
                    "pid": pid,
                }));
            }
            (200, serde_json::to_string(&serde_json::json!({ "servers": out })).unwrap_or_default())
        }
        ("GET", ["log", id]) => {
            // Reuse get_log_tail via the public impl.
            match tail_log(handle, id) {
                Ok(lines) => (200, serde_json::to_string(&serde_json::json!({ "lines": lines })).unwrap_or_default()),
                Err(e) => (404, err(&e)),
            }
        }
        ("POST", ["start", id]) => act(handle, id, "start"),
        ("POST", ["stop", id]) => act(handle, id, "stop"),
        ("POST", ["restart", id]) => act(handle, id, "restart"),
        _ => (404, err("not found")),
    }
}

/// Runs a lifecycle action by id, returning a JSON status.
fn act(handle: &AppHandle, id: &str, action: &str) -> (u16, String) {
    use crate::commands;
    let result = match action {
        "start" => commands::launch_instance(handle, id).map(|_| "started"),
        "stop" => commands::stop_server_instance(handle.clone(), id.to_string()).map(|_| "stopped"),
        "restart" => commands::restart_server_instance(handle.clone(), id.to_string()).map(|_| "restarted"),
        _ => Err("unknown action".to_string()),
    };
    match result {
        Ok(msg) => (200, ok(&format!("{{\"action\":\"{msg}\"}}"))),
        Err(e) => (500, err(&e)),
    }
}

/// Reads the tail of an instance's latest.log (last 100 lines).
fn tail_log(handle: &AppHandle, id: &str) -> Result<Vec<String>, String> {
    let cfg = config::load_config(handle)?;
    let instance = cfg
        .servers
        .get(id)
        .ok_or_else(|| format!("server '{id}' not found"))?;
    let log_path = std::path::PathBuf::from(&instance.path).join("latest.log");
    if !log_path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&log_path)
        .map_err(|e| format!("failed to read log: {e}"))?;
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(100);
    Ok(lines[start..].iter().map(|s| s.to_string()).collect())
}

/// Writes an HTTP/1.0 response.
fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Status",
    };
    let out = format!(
        "HTTP/1.0 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(out.as_bytes())?;
    Ok(())
}

fn ok(body: &str) -> String {
    body.to_string()
}
fn err(msg: &str) -> String {
    serde_json::to_string(&serde_json::json!({ "error": msg })).unwrap_or_default()
}
