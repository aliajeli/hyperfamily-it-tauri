//! Port of electron/services/ping.service.js — spawns the OS ping utility,
//! parses localized `time=`/`zeit=`/`temps=`/`tiempo=` output, classifies
//! >300 ms as `warning`.

use crate::error::AppResult;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::process::Command;

pub async fn ping_host(host: &str, timeout_ms: u64) -> Value {
    let is_windows = cfg!(windows);
    let mut command = if is_windows {
        let mut command = Command::new("ping");
        command.args(["-n", "1", "-w", &timeout_ms.to_string(), host]);
        command
    } else {
        let mut command = Command::new("ping");
        command.args([
            "-c",
            "1",
            "-W",
            &std::cmp::max(1, (timeout_ms / 1000).max(1)).to_string(),
            host,
        ]);
        command
    };
    command.kill_on_drop(true);
    #[cfg(windows)]
    {
        // tokio::process::Command carries an inherent creation_flags on Windows.
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let started = std::time::Instant::now();
    let output = tokio::time::timeout(Duration::from_millis(timeout_ms + 750), command.output()).await;
    let stdout = match output {
        Ok(Ok(output)) => String::from_utf8_lossy(&output.stdout).to_string(),
        _ => return json!({ "status": "offline", "ping_time": Value::Null }),
    };
    let mut ping_time: Option<u64> = None;
    let mut less_than_one = false;
    // Line-based scan mirroring the original regexes.
    for line in stdout.lines() {
        let lower = line.to_lowercase();
        if let Some(position) = ["time", "zeit", "temps", "tiempo"]
            .iter()
            .filter_map(|word| lower.find(word))
            .min()
        {
            let rest = &lower[position..];
            let digits: String = rest
                .chars()
                .skip_while(|c| !c.is_ascii_digit() && *c != '.')
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if !digits.is_empty() {
                if let Ok(value) = digits.parse::<f64>() {
                    ping_time = Some(std::cmp::max(1, value.round() as u64));
                }
            }
        }
        if less_than_one {
            continue;
        }
        for word in ["time", "zeit", "temps", "tiempo"] {
            if let Some(position) = lower.find(word) {
                let rest = &lower[position + word.len()..];
                if rest.starts_with("<1ms") || rest.starts_with("< 1ms") {
                    less_than_one = true;
                }
            }
        }
    }
    if stdout.contains("<1ms") || stdout.contains("< 1ms") {
        less_than_one = true;
    }
    let ping_time = if less_than_one {
        1
    } else {
        match ping_time {
            Some(value) => value,
            None => return json!({ "status": "offline", "ping_time": Value::Null, "_ms": started.elapsed().as_millis() as u64 }),
        }
    };
    let status = if ping_time <= 300 { "online" } else { "warning" };
    json!({ "status": status, "ping_time": ping_time })
}

/// One monitoring pass: every dashboard-visible device in parallel, then a
/// batched history write and a `monitor:update` broadcast.
pub async fn monitor_tick(
    database: &std::sync::Arc<crate::db::AppDatabase>,
    emit: &crate::services::Emitter,
) -> AppResult<()> {
    let devices = database.list_monitored_devices()?;
    if !devices.is_empty() {
        let probes: Vec<_> = devices
            .iter()
            .map(|device| {
                let ip = device.get("ip").and_then(Value::as_str).unwrap_or("").to_string();
                let id = device.get("id").and_then(Value::as_i64).unwrap_or(0);
                async move {
                    let result = ping_host(&ip, 1000).await;
                    json!({ "device_id": id, "status": result["status"], "ping_time": result["ping_time"] })
                }
            })
            .collect();
        let results: Vec<Value> = futures_join(probes).await;
        database.record_ping_batch(&results)?;
    }
    let settings = database.get_settings()?;
    let history = settings.get("ping_history_count").and_then(Value::as_i64).unwrap_or(30);
    let snapshot = database.get_monitor_snapshot(history)?;
    emit("monitor:update", snapshot);
    Ok(())
}

/// Poor-man's join on a fixed list (avoids pulling futures-util).
async fn futures_join(tasks: Vec<impl std::future::Future<Output = Value> + Send + 'static>) -> Vec<Value> {
    let mut set = tokio::task::JoinSet::new();
    for task in tasks {
        set.spawn(task);
    }
    let mut out = Vec::new();
    while let Some(result) = set.join_next().await {
        if let Ok(value) = result {
            out.push(value);
        }
    }
    out
}
