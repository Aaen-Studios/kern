//! Background worker — the single periodic loop that powers three features:
//!
//!   1. **Backup scheduler** — every tick, for each instance whose
//!      `backup_schedule.interval_secs > 0`, if enough time has passed since
//!      `last_backup_secs`, snapshot the world and prune to `keep`.
//!   2. **Health alerts** — sample each running instance's metrics; if a
//!      threshold (CPU/RAM) is sustained beyond `sustained_secs`, emit a
//!      `kern://health-alert` event the frontend turns into a toast.
//!   3. **Metrics history** — append every sample to `MetricsHistory` so the
//!      24h/7d resource graphs have data.
//!
//! All three run on one 30s cadence. The loop is intentionally simple (sleep +
//! poll) rather than a cron engine — matches the codebase's existing pattern
//! (the autostart loop in `lib.rs`). Config mutations go through
//! `config::with_config_mut` to stay race-free with the UI.

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};

use crate::commands;
use crate::config;
use crate::metrics::{MetricSample, MetricsHistory, MetricsState};
use crate::process;

/// The worker's tick interval. 30s balances alert responsiveness against
/// sampling cost (a full sysinfo refresh each tick).
const TICK_SECS: u64 = 30;

/// Payload for the `kern://health-alert` event.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthAlert {
    id: String,
    name: String,
    metric: String, // "cpu" | "ram"
    value: f32,     // fraction 0.0..=1.0
    threshold: f32,
}

/// Spawns the background worker. Call once at the end of `setup` in `lib.rs`.
/// Runs for the lifetime of the app.
pub fn spawn(app_handle: &AppHandle) {
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(TICK_SECS));
            tick(&handle);
        }
    });
}

/// One iteration: sample metrics, run backup due-checks, evaluate alerts.
fn tick(handle: &AppHandle) {
    let now = now_secs();

    // Snapshot config once (read-only); mutations re-load under the lock.
    let Ok(cfg) = config::load_config(handle) else {
        return;
    };

    // ── Sample metrics for every running instance ────────────────────────
    let metrics_state: tauri::State<'_, MetricsState> = handle.state();
    let history: tauri::State<'_, MetricsHistory> = handle.state();

    let mut samples: Vec<(String, f32, f32)> = Vec::new(); // (id, cpu, ram)

    for (id, instance) in &cfg.servers {
        if !process::is_running(handle, id) {
            // Not running — reset any alert "crossed since" timestamp so a
            // restart doesn't immediately re-fire a stale alert.
            if instance.alert_rules.crossed_since_secs != 0 {
                let idown = id.clone();
                let h = handle.clone();
                let _ = config::with_config_mut(&h, |c| {
                    if let Some(s) = c.servers.get_mut(&idown) {
                        s.alert_rules.crossed_since_secs = 0;
                    }
                    Ok(())
                });
            }
            continue;
        }
        let Some(pid) = process::pid_for(handle, id) else {
            continue;
        };
        if let Some(m) = metrics_state.instance_metrics(pid, &instance.status) {
            samples.push((id.clone(), m.cpu, m.ram));
            history.record(
                id,
                MetricSample {
                    at: now,
                    cpu: m.cpu,
                    ram: m.ram,
                },
            );
        }
    }

    // ── Evaluate alerts + run due backups ────────────────────────────────
    // We iterate by id so each with_config_mut is a tiny targeted update.
    for (id, cpu, ram) in &samples {
        let Some(instance) = cfg.servers.get(id) else {
            continue;
        };
        let rules = &instance.alert_rules;

        // Alert evaluation.
        let cpu_over = rules
            .cpu_threshold
            .map(|t| *cpu > t)
            .unwrap_or(false);
        let ram_over = rules
            .ram_threshold
            .map(|t| *ram > t)
            .unwrap_or(false);
        if cpu_over || ram_over {
            // Track how long it's been over. If first crossing, stamp it;
            // if sustained past the window, fire once and reset.
            let crossed = rules.crossed_since_secs;
            let started = if crossed == 0 { now } else { crossed };
            if crossed == 0 {
                let idown = id.clone();
                let h = handle.clone();
                let _ = config::with_config_mut(&h, |c| {
                    if let Some(s) = c.servers.get_mut(&idown) {
                        s.alert_rules.crossed_since_secs = now;
                    }
                    Ok(())
                });
            } else if now.saturating_sub(started) >= rules.sustained_secs {
                // Fire + reset so it can re-fire later if it stays elevated.
                let (metric, value, threshold) = if cpu_over {
                    ("cpu", *cpu, rules.cpu_threshold.unwrap_or(0.0))
                } else {
                    ("ram", *ram, rules.ram_threshold.unwrap_or(0.0))
                };
                let _ = handle.emit(
                    "kern://health-alert",
                    HealthAlert {
                        id: id.clone(),
                        name: instance.name.clone(),
                        metric: metric.to_string(),
                        value,
                        threshold,
                    },
                );
                let idown = id.clone();
                let h = handle.clone();
                let _ = config::with_config_mut(&h, |c| {
                    if let Some(s) = c.servers.get_mut(&idown) {
                        s.alert_rules.crossed_since_secs = 0;
                    }
                    Ok(())
                });
            }
        } else if rules.crossed_since_secs != 0 {
            // Recovered below threshold — clear the timer.
            let idown = id.clone();
            let h = handle.clone();
            let _ = config::with_config_mut(&h, |c| {
                if let Some(s) = c.servers.get_mut(&idown) {
                    s.alert_rules.crossed_since_secs = 0;
                }
                Ok(())
            });
        }

        // Backup due-check.
        let sched = &instance.backup_schedule;
        if sched.interval_secs > 0
            && now.saturating_sub(sched.last_backup_secs) >= sched.interval_secs
            && has_world_dir(&instance.path)
        {
            let idown = id.clone();
            let keep = sched.keep;
            let h = handle.clone();
            // Run the backup, then record the time (only on success).
            match commands::backup_world_impl(&h, &idown) {
                Ok(_archive) => {
                    commands::prune_backups_impl(&h, &idown, keep);
                    let _ = config::with_config_mut(&h, |c| {
                        if let Some(s) = c.servers.get_mut(&idown) {
                            s.backup_schedule.last_backup_secs = now;
                        }
                        Ok(())
                    });
                    let _ = h.emit(
                        "kern://backup-completed",
                        serde_json::json!({ "id": idown, "at": now }),
                    );
                }
                Err(e) => {
                    eprintln!("[scheduler] backup failed for '{idown}': {e}");
                }
            }
        }
    }
}

/// True if `<instance_path>/world` exists (cheap guard before zipping).
fn has_world_dir(instance_path: &str) -> bool {
    std::path::Path::new(instance_path).join("world").is_dir()
}

/// Current epoch seconds.
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
