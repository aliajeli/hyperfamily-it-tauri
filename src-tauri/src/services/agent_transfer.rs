//! Port of electron/services/agent-transfer.service.js — WAN-tolerant hashing
//! and copying with idle/max deadlines and live progress formatting.

use crate::error::{AppError, AppResult};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Instant;

pub const TRANSFER_IDLE_MS: u64 = 120_000;
pub const TRANSFER_MAX_MS: u64 = 30 * 60 * 1000;
pub const TRANSFER_BUFFER_BYTES: usize = 1024 * 1024;

pub struct ProgressStats {
    pub bytes: u64,
    pub total_bytes: u64,
    pub elapsed_ms: u64,
    pub bytes_per_second: f64,
}

pub fn format_progress(stats: &ProgressStats) -> String {
    let mb = |value: u64| format!("{:.1}", value as f64 / 1_000_000.0);
    let count = if stats.total_bytes > 0 {
        format!(
            "{} / {} MB ({}%)",
            mb(stats.bytes),
            mb(stats.total_bytes),
            std::cmp::min(100, stats.bytes * 100 / std::cmp::max(1, stats.total_bytes))
        )
    } else {
        format!("{} MB", mb(stats.bytes))
    };
    format!("{count}, {:.0} KB/s, {} s elapsed", stats.bytes_per_second / 1000.0, stats.elapsed_ms / 1000)
}

fn elapsed_max_exceeded(started: &Instant, max_ms: u64) -> bool {
    started.elapsed().as_millis() as u64 > max_ms
}

pub async fn hash_file(file: &Path, label: &str, on_progress: Option<crate::services::Emitter>) -> AppResult<String> {
    let path = file.to_path_buf();
    let label = label.to_string();
    tokio::task::spawn_blocking(move || -> AppResult<String> {
        use std::io::Read;
        let mut file = std::fs::File::open(&path).map_err(|error| AppError::new(format!("{label}: {error}")))?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; TRANSFER_BUFFER_BYTES];
        let progress = std::sync::Arc::new(parking_lot::Mutex::new(Instant::now()));
        let bytes_total = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let idle = std::sync::Arc::new(parking_lot::Mutex::new(Instant::now()));
        let deadline_failed: std::sync::Arc<parking_lot::Mutex<Option<String>>> = Default::default();
        let started = Instant::now();
        loop {
            let read = file.read(&mut buffer).map_err(|error| AppError::new(format!("{label}: {error}")))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            *idle.lock() = Instant::now();
            bytes_total.fetch_add(read as u64, std::sync::atomic::Ordering::Relaxed);
            if let Some(emitter) = &on_progress {
                let should_report = {
                    let mut last = progress.lock();
                    if last.elapsed() >= std::time::Duration::from_millis(1000) {
                        *last = Instant::now();
                        true
                    } else {
                        false
                    }
                };
                if should_report {
                    let so_far = bytes_total.load(std::sync::atomic::Ordering::Relaxed);
                    let elapsed = started.elapsed().as_millis() as u64;
                    let stats = ProgressStats { bytes: so_far, total_bytes: 0, elapsed_ms: elapsed, bytes_per_second: if elapsed > 0 { so_far as f64 * 1000.0 / elapsed as f64 } else { 0.0 } };
                    let message = format!("{label}: {}", format_progress(&stats));
                    emitter("agent-transfer:progress", json!({ "label": label, "detail": message, "bytes": so_far, "elapsedMs": elapsed }));
                }
            }
            // Deadline checks on every megabyte keep the loop responsive.
            if idle.lock().elapsed().as_millis() as u64 > TRANSFER_IDLE_MS || elapsed_max_exceeded(&started, TRANSFER_MAX_MS) {
                let reason = if idle.lock().elapsed().as_millis() as u64 > TRANSFER_IDLE_MS {
                    format!("no I/O progress for {} seconds", TRANSFER_IDLE_MS / 1000)
                } else {
                    format!("exceeded the {} minute maximum transfer duration", TRANSFER_MAX_MS / 60000)
                };
                *deadline_failed.lock() = Some(reason);
            }
            if let Some(reason) = deadline_failed.lock().clone() {
                let so_far = bytes_total.load(std::sync::atomic::Ordering::Relaxed);
                let elapsed = started.elapsed().as_millis() as u64;
                let stats = ProgressStats { bytes: so_far, total_bytes: 0, elapsed_ms: elapsed, bytes_per_second: 0.0 };
                return Err(AppError::new(format!("{label}: {reason} ({}). Check the branch WAN/VPN/SMB connection and retry Import Agent.", format_progress(&stats))));
            }
        }
        Ok(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|error| AppError::new(error.to_string()))?
}

pub async fn copy_file(source: &Path, destination: &Path, label: &str, on_progress: Option<crate::services::Emitter>) -> AppResult<()> {
    let source = source.to_path_buf();
    let destination = destination.to_path_buf();
    let label = label.to_string();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        use std::io::{Read, Write};
        // `wx`: exclusive creation so a partially staged copy is never reused.
        let mut input = std::fs::File::open(&source).map_err(|error| AppError::new(format!("{label}: {error}")))?;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|error| AppError::new(format!("{label}: {error}")))?;
        let mut buffer = vec![0u8; TRANSFER_BUFFER_BYTES];
        let written = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let idle = std::sync::Arc::new(parking_lot::Mutex::new(Instant::now()));
        let started = Instant::now();
        let deadline_failed: std::sync::Arc<parking_lot::Mutex<Option<String>>> = Default::default();
        let report_progress = {
            let written = written.clone();
            let label = label.clone();
            move || {
                let so_far = written.load(std::sync::atomic::Ordering::Relaxed);
                let elapsed = started.elapsed().as_millis() as u64;
                let stats = ProgressStats {
                    bytes: so_far,
                    total_bytes: 0,
                    elapsed_ms: elapsed,
                    bytes_per_second: if elapsed > 0 { so_far as f64 * 1000.0 / elapsed as f64 } else { 0.0 },
                };
                let message = format!("{label}: {}", format_progress(&stats));
                (message, so_far, elapsed)
            }
        };
        let mut next_report = Instant::now();
        loop {
            // Only completed WRITES reset the idle clock — not fast local reads
            // buffered in RAM while an SMB write is stalled.
            match input.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    output.write_all(&buffer[..read]).map_err(|error| AppError::new(format!("{label}: {error}")))?;
                    written.fetch_add(read as u64, std::sync::atomic::Ordering::Relaxed);
                    *idle.lock() = Instant::now();
                }
                Err(error) => return Err(AppError::new(format!("{label}: {error}"))),
            }
            if idle.lock().elapsed().as_millis() as u64 > TRANSFER_IDLE_MS || elapsed_max_exceeded(&started, TRANSFER_MAX_MS) {
                let reason = if idle.lock().elapsed().as_millis() as u64 > TRANSFER_IDLE_MS {
                    format!("no I/O progress for {} seconds", TRANSFER_IDLE_MS / 1000)
                } else {
                    format!("exceeded the {} minute maximum transfer duration", TRANSFER_MAX_MS / 60000)
                };
                *deadline_failed.lock() = Some(reason);
            }
            if let Some(reason) = deadline_failed.lock().clone() {
                let (message, _, _) = report_progress();
                return Err(AppError::new(format!("{label}: {reason} ({message}). Check the branch WAN/VPN/SMB connection and retry Import Agent.")));
            }
            if let Some(emitter) = &on_progress {
                if next_report.elapsed() >= std::time::Duration::from_millis(1000) {
                    next_report = Instant::now();
                    let (message, bytes, elapsed) = report_progress();
                    emitter("agent-transfer:progress", json!({ "label": label, "detail": message, "bytes": bytes, "elapsedMs": elapsed }));
                }
            }
        }
        output.flush().map_err(|error| AppError::new(format!("{label}: {error}")))?;
        Ok(())
    })
    .await
    .map_err(|error| AppError::new(error.to_string()))?
}
