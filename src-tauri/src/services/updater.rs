//! Port of electron/services/update.service.js, retargeted to the Tauri
//! updater. `check` reads the same GitHub releases list for the About card;
//! download/install ride on tauri-plugin-updater (minisign-verified artifacts
//! attached to this repository's releases). Pause semantics match the
//! original exactly: a pause CANCELS the in-flight download, keeps the
//! progress numbers on screen, and a resume restarts from the top.

use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Instant;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

const RELEASES_API: &str = "https://api.github.com/repos/aliajeli/hyperfamily-it-tauri/releases";

pub fn compare_versions(v1: &str, v2: &str) -> std::cmp::Ordering {
    let parse = |value: &str| -> Vec<i64> {
        value
            .trim_start_matches('v')
            .split('.')
            .map(|part| {
                let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
                digits.parse::<i64>().unwrap_or(0)
            })
            .collect()
    };
    let a = parse(v1);
    let b = parse(v2);
    for index in 0..std::cmp::max(a.len(), b.len()) {
        let left = a.get(index).copied().unwrap_or(0);
        let right = b.get(index).copied().unwrap_or(0);
        match left.cmp(&right) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

#[derive(Clone)]
pub struct UpdateService {
    pub app: AppHandle,
    pub emitter: crate::services::Emitter,
    pub status: Arc<parking_lot::Mutex<Value>>,
    pub rate_window: Arc<parking_lot::Mutex<(Instant, u64, f64)>>,
}

impl UpdateService {
    pub fn new(app: AppHandle, emitter: crate::services::Emitter) -> Self {
        Self {
            app,
            emitter,
            status: Arc::new(parking_lot::Mutex::new(Self::idle_status())),
            rate_window: Arc::new(parking_lot::Mutex::new((Instant::now(), 0, 0.0))),
        }
    }

    /// The shape every idle/reset status uses, so no field can go missing.
    pub fn idle_status() -> Value {
        json!({
            "downloading": false, "paused": false, "downloaded": false,
            "percent": 0, "version": Value::Null, "viaFallback": false,
            "transferred": 0, "total": 0, "remaining": 0,
            "bytesPerSecond": 0, "etaSeconds": Value::Null
        })
    }

    fn emit(&self, payload: Value) {
        (self.emitter)("update:event", payload);
    }

    pub fn state(&self) -> Value {
        let mut status = self.status.lock().clone();
        if let Value::Object(map) = &mut status {
            map.insert("canInstall".into(), json!(status.get("downloaded").and_then(Value::as_bool).unwrap_or(false)));
            map.insert("isPackaged".into(), json!(!cfg!(debug_assertions)));
        }
        status
    }

    /// Lists published stable releases for the About page's update card.
    pub async fn check(&self) -> AppResult<Value> {
        let current_version = self.app.package_info().version.to_string();
        let client = reqwest::Client::new();
        let response = client
            .get(format!("{RELEASES_API}?per_page=20"))
            .header("User-Agent", "HyperFamily-Branch-Monitor")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|error| AppError::new(format!("GitHub update check failed: {error}")))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(json!({ "currentVersion": current_version, "latestVersion": current_version, "hasUpdate": false, "releaseNotes": "No published release found yet." }));
        }
        if !response.status().is_success() {
            return Err(AppError::new(format!("GitHub update check failed ({})", response.status())));
        }
        let releases: Value = response.json().await.map_err(|error| AppError::new(error.to_string()))?;
        let published: Vec<&Value> = releases
            .as_array()
            .map(|list| list.iter().filter(|item| !item.get("draft").and_then(Value::as_bool).unwrap_or(false) && !item.get("prerelease").and_then(Value::as_bool).unwrap_or(false)).collect())
            .unwrap_or_default();
        if published.is_empty() {
            return Ok(json!({ "currentVersion": current_version, "latestVersion": current_version, "hasUpdate": false, "releaseNotes": "No published release found yet." }));
        }
        // Pick the newest version, then merge every release sharing that tag
        // so the installer is found regardless of which run attached it.
        let mut newest: Option<(String, &Value)> = None;
        for item in &published {
            let tag = item.get("tag_name").and_then(Value::as_str).unwrap_or("").trim_start_matches('v').to_string();
            let replace = match &newest {
                Some((current, _)) => compare_versions(&tag, current) == std::cmp::Ordering::Greater,
                None => true,
            };
            if replace {
                newest = Some((tag, item));
            }
        }
        let Some((latest_version, newest_item)) = newest else {
            return Ok(json!({ "currentVersion": current_version, "latestVersion": current_version, "hasUpdate": false, "releaseNotes": "No published release found yet." }));
        };
        let tag = newest_item.get("tag_name").and_then(Value::as_str).unwrap_or("").to_string();
        let same_tag: Vec<&Value> = published.into_iter().filter(|item| item.get("tag_name").and_then(Value::as_str) == Some(tag.as_str())).collect();
        let mut assets: Vec<&Value> = Vec::new();
        for item in &same_tag {
            if let Some(list) = item.get("assets").and_then(Value::as_array) {
                assets.extend(list.iter());
            }
        }
        let installer = assets.iter().find(|asset| asset.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase().ends_with(".exe"));
        let notes = same_tag.iter().filter_map(|item| item.get("body").and_then(Value::as_str)).find(|body| !body.is_empty()).unwrap_or("").to_string();
        let download_url = installer
            .and_then(|asset| asset.get("browser_download_url").and_then(Value::as_str))
            .or_else(|| newest_item.get("html_url").and_then(Value::as_str))
            .map(String::from);
        let download_size = installer.and_then(|asset| asset.get("size").and_then(Value::as_u64)).unwrap_or(0);
        let download_name = installer.and_then(|asset| asset.get("name").and_then(Value::as_str)).map(String::from);
        {
            let mut status = self.status.lock();
            if download_size > 0 && !status.get("downloading").and_then(Value::as_bool).unwrap_or(false) && !status.get("downloaded").and_then(Value::as_bool).unwrap_or(false) {
                status["total"] = json!(download_size);
            }
        }
        let mut result = json!({
            "currentVersion": current_version,
            "latestVersion": latest_version,
            "hasUpdate": compare_versions(&latest_version, &current_version) == std::cmp::Ordering::Greater,
            "releaseNotes": notes,
            "publishedAt": newest_item.get("published_at").cloned().unwrap_or(Value::Null),
            "downloadUrl": download_url,
            "downloadSize": download_size,
            "downloadName": download_name
        });
        if let (Value::Object(base), Value::Object(state)) = (&mut result, &self.state()) {
            for (key, value) in state {
                base.insert(key.clone(), value.clone());
            }
        }
        Ok(result)
    }

    fn report_progress(&self, transferred: u64, total: u64, bytes_per_second: Option<f64>) {
        let paused = self.status.lock().get("paused").and_then(Value::as_bool).unwrap_or(false);
        if paused {
            return;
        }
        let now = Instant::now();
        let mut rate_window = self.rate_window.lock();
        let mut rate = bytes_per_second.unwrap_or(0.0);
        if rate == 0.0 {
            let elapsed = now.duration_since(rate_window.0).as_secs_f64();
            if elapsed >= 0.4 {
                let instant = (transferred.saturating_sub(rate_window.1)) as f64 / elapsed;
                rate = if rate_window.2 > 0.0 { rate_window.2 * 0.7 + instant * 0.3 } else { instant };
                *rate_window = (now, transferred, rate);
            } else {
                rate = rate_window.2;
            }
        } else {
            *rate_window = (now, transferred, rate);
        }
        let remaining = if total > 0 { total.saturating_sub(transferred) } else { 0 };
        let percent = if total > 0 { ((transferred as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as i64 } else { 0 };
        let eta = if rate > 1024.0 && remaining > 0 { Some((remaining as f64 / rate).round() as i64) } else { None };
        {
            let mut status = self.status.lock();
            status["downloading"] = json!(true);
            status["percent"] = json!(percent);
            status["transferred"] = json!(transferred);
            status["total"] = json!(total);
            status["remaining"] = json!(remaining);
            status["bytesPerSecond"] = json!(rate.max(0.0).round() as i64);
            status["etaSeconds"] = json!(eta);
        }
        self.emit(json!({
            "type": "progress",
            "percent": percent,
            "transferred": transferred,
            "total": total,
            "remaining": remaining,
            "bytesPerSecond": rate.max(0.0).round() as i64,
            "etaSeconds": eta
        }));
    }

    fn mark_downloaded(&self, version: &str) {
        let total = self.status.lock().get("total").and_then(Value::as_u64).unwrap_or(0);
        {
            let mut status = self.status.lock();
            let mut fresh = Self::idle_status();
            if let Value::Object(map) = &mut fresh {
                map.insert("downloaded".into(), json!(true));
                map.insert("percent".into(), json!(100));
                map.insert("version".into(), json!(version));
                map.insert("transferred".into(), json!(total));
                map.insert("total".into(), json!(total));
            }
            *status = fresh;
        }
        self.emit(json!({ "type": "downloaded", "version": version, "viaFallback": false, "total": total }));
    }

    /// Downloads the update through the Tauri updater (signature-verified).
    /// The plugin's chunk callback cannot cancel a download, so the task is
    /// spawned and ABORTED on pause/stop — the Electron semantics (pause
    /// cancels, numbers stay on screen, resume restarts) are preserved.
    pub async fn download(&self, cancel: Arc<std::sync::atomic::AtomicBool>) -> AppResult<Value> {
        if cfg!(debug_assertions) {
            return Err(AppError::new("Update downloads are enabled in packaged builds only"));
        }
        {
            let status = self.status.lock();
            if status.get("downloading").and_then(Value::as_bool).unwrap_or(false) {
                return Err(AppError::new("A download is already running"));
            }
            if status.get("downloaded").and_then(Value::as_bool).unwrap_or(false) {
                return Ok(self.state());
            }
        }
        {
            let known_total = self.status.lock().get("total").and_then(Value::as_u64).unwrap_or(0);
            let mut status = self.status.lock();
            let mut fresh = Self::idle_status();
            if let Value::Object(map) = &mut fresh {
                map.insert("downloading".into(), json!(true));
                map.insert("total".into(), json!(known_total));
                map.insert("remaining".into(), json!(known_total));
            }
            *status = fresh;
        }
        *self.rate_window.lock() = (Instant::now(), 0, 0.0);
        self.emit(json!({ "type": "progress", "percent": 0, "transferred": 0, "total": 0, "remaining": 0, "bytesPerSecond": 0, "etaSeconds": Value::Null }));

        let service = self.clone();
        let task = tauri::async_runtime::spawn(async move {
            let updater = service.app.updater().map_err(|error| AppError::new(error.to_string()))?;
            let update = updater
                .check()
                .await
                .map_err(|error| AppError::new(format!("The update service could not be reached: {error}")))?;
            let Some(update) = update else {
                return Err(AppError::new("No update is currently published"));
            };
            let version = update.current_version.clone();
            let tracker = service.clone();
            update
                .download(
                    move |chunk: usize, total: Option<u64>| {
                        tracker.register_chunk(chunk as u64, total);
                    },
                    || {},
                )
                .await
                .map_err(|error| AppError::new(error.to_string()))?;
            Ok(version)
        });

        loop {
            tokio::select! {
                result = &mut task => {
                    return match result {
                        Ok(Ok(version)) => {
                            self.mark_downloaded(&version);
                            Ok(self.state())
                        }
                        Ok(Err(error)) => {
                            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                                // Stopped right at the end; keep the numbers.
                                return Ok(self.state());
                            }
                            {
                                let mut status = self.status.lock();
                                *status = Self::idle_status();
                            }
                            let text = error.message.clone();
                            let message = if text.to_lowercase().contains("signature")
                                || text.to_lowercase().contains("pubkey")
                                || text.to_lowercase().contains("public key")
                            {
                                format!("The update could not be verified ({text}). Configure the updater signing key \u{2014} see README, Releases section.")
                            } else {
                                format!("Downloading the installer failed: {text}")
                            };
                            self.emit(json!({ "type": "error", "message": message }));
                            Err(AppError::new(message))
                        }
                        Err(join_error) => {
                            // The task itself was aborted — treat like a pause.
                            if cancel.load(std::sync::atomic::Ordering::Relaxed) || join_error.is_cancelled() {
                                return Ok(self.state());
                            }
                            Err(AppError::new(format!("The update download failed: {join_error}")))
                        }
                    };
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(120)) => {
                    if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                        task.abort();
                        // pause() has usually flipped the flags already; only
                        // mark the pause here when it has not (e.g. stop was
                        // NOT requested and the command raced us).
                        let was_downloading = {
                            let mut status = self.status.lock();
                            let downloading = status.get("downloading").and_then(Value::as_bool).unwrap_or(false);
                            if downloading {
                                status["paused"] = json!(true);
                                status["downloading"] = json!(false);
                            }
                            downloading
                        };
                        if was_downloading {
                            let percent = self.status.lock().get("percent").cloned().unwrap_or(json!(0));
                            self.emit(json!({ "type": "paused", "percent": percent }));
                        }
                        return Ok(self.state());
                    }
                }
            }
        }
    }

    fn register_chunk(&self, chunk: u64, total: Option<u64>) {
        let mut tracker = self.status.lock();
        let transferred = tracker.get("transferred").and_then(Value::as_u64).unwrap_or(0) + chunk;
        tracker["transferred"] = json!(transferred);
        if let Some(total) = total {
            if total > 0 {
                tracker["total"] = json!(total);
            }
        }
    }

    pub async fn pause(&self, cancel: &Arc<std::sync::atomic::AtomicBool>) -> AppResult<Value> {
        {
            let status = self.status.lock();
            if status.get("paused").and_then(Value::as_bool).unwrap_or(false) {
                return Ok(self.state());
            }
            if !status.get("downloading").and_then(Value::as_bool).unwrap_or(false) {
                return Err(AppError::new("No download is running"));
            }
        }
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        let percent = self.status.lock().get("percent").cloned().unwrap_or(json!(0));
        {
            let mut status = self.status.lock();
            status["paused"] = json!(true);
            status["downloading"] = json!(false);
        }
        self.emit(json!({ "type": "paused", "percent": percent }));
        Ok(self.state())
    }

    pub async fn resume(&self, cancel: &Arc<std::sync::atomic::AtomicBool>) -> AppResult<Value> {
        {
            let status = self.status.lock();
            if !status.get("paused").and_then(Value::as_bool).unwrap_or(false) {
                return Err(AppError::new("Nothing is paused"));
            }
            status["paused"] = json!(false);
        }
        self.emit(json!({ "type": "resumed" }));
        cancel.store(false, std::sync::atomic::Ordering::Relaxed);
        self.download(cancel.clone()).await
    }

    pub async fn stop(&self, cancel: &Arc<std::sync::atomic::AtomicBool>) -> AppResult<Value> {
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        {
            let mut status = self.status.lock();
            *status = Self::idle_status();
        }
        self.emit(json!({ "type": "stopped" }));
        Ok(self.state())
    }

    /// Installs the downloaded update and restarts the application.
    pub async fn install(&self) -> AppResult<Value> {
        let downloaded = self.status.lock().get("downloaded").and_then(Value::as_bool).unwrap_or(false);
        if !downloaded {
            return Err(AppError::new("Download the update first"));
        }
        let updater = self.app.updater().map_err(|error| AppError::new(error.to_string()))?;
        let update = updater
            .check()
            .await
            .map_err(|error| AppError::new(format!("The update service could not be reached: {error}")))?;
        let Some(update) = update else {
            return Err(AppError::new("No update is currently published"));
        };
        tauri::async_runtime::spawn(async move {
            let _ = update.install().await;
        });
        Ok(json!({ "success": true }))
    }
}
