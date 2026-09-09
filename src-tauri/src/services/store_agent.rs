//! Port of electron/services/store-agent.service.js — heartbeat/inventory
//! inspection and the fully narrated Import Agent pipeline with staged
//! replacement, ACL hardening, rollback and cross-workstation locking.

use crate::error::{AppError, AppResult};
use crate::services::agent_control::{AgentControl, AGENT_EXE};
use crate::services::reachability::check_reachable;
use crate::services::smb::{normalize_host, SmbSessionManager};
use crate::services::Emitter;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

pub const HEARTBEAT_MAX_AGE_MS: i64 = 60_000;
pub const MAX_INVENTORY_BYTES: u64 = 8 * 1024 * 1024;

/// Validates an agent heartbeat/inventory snapshot (protocol v1).
pub fn validate_snapshot(raw: &str, now_ms: i64) -> AppResult<Value> {
    let text = raw.trim_start_matches('\u{feff}');
    let data: Value = serde_json::from_str(text).map_err(|_| AppError::new("The agent heartbeat/inventory has an unsupported format; Import Agent again"))?;
    let pid = data.get("pid").and_then(Value::as_i64).unwrap_or(0);
    let programs = data.get("programs").and_then(Value::as_array).cloned().unwrap_or_default();
    let valid = data.get("protocolVersion").and_then(Value::as_i64) == Some(1)
        && data.get("state").and_then(Value::as_str) == Some("running")
        && pid > 0
        && !data.get("instanceId").map(Value::is_null).unwrap_or(true)
        && programs.len() <= 20000
        && programs.iter().all(|row| row.get("name").and_then(Value::as_str).is_some() && row.get("version").and_then(Value::as_str).is_some());
    if !valid {
        return Err(AppError::new("The agent heartbeat/inventory has an unsupported format; Import Agent again"));
    }
    let at_text = data.get("generatedAt").and_then(Value::as_str).unwrap_or("");
    let at = chrono::DateTime::parse_from_rfc3339(at_text).map(|parsed| parsed.timestamp_millis()).ok();
    let Some(at) = at else {
        return Err(AppError::new("Agent heartbeat is stale or the checkout clock is out of sync; check the service and Windows time"));
    };
    if now_ms - at > HEARTBEAT_MAX_AGE_MS || at - now_ms > HEARTBEAT_MAX_AGE_MS {
        return Err(AppError::new("Agent heartbeat is stale or the checkout clock is out of sync; check the service and Windows time"));
    }
    Ok(data)
}

pub struct StoreAgentService {
    pub source_path: PathBuf,
    pub control: AgentControl,
    pub smb: Arc<SmbSessionManager>,
    pub get_credentials: Box<dyn Fn() -> Value + Send + Sync>,
    pub locks: Arc<parking_lot::Mutex<HashMap<String, ()>>>,
    pub heartbeat_wait_ms: u64,
}

fn map_path(host: &str, relative: &str) -> String {
    let host = normalize_host(host).unwrap_or_else(|_| host.trim().trim_start_matches('\\').to_string());
    if relative.is_empty() {
        format!(r"\\{host}\C$\Agent")
    } else {
        format!(r"\\{host}\C$\Agent\{}", relative.replace('/', "\\"))
    }
}

async fn optional_stat(file: &str) -> AppResult<Option<std::fs::Metadata>> {
    let path = file.to_string();
    let handle = tokio::time::timeout(Duration::from_millis(12000), tokio::fs::symlink_metadata(&path)).await;
    match handle {
        Err(_) => Err(AppError::new("Timed out accessing the agent files")),
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Ok(Err(error)) => Err(AppError::new(error.to_string())),
        Ok(Ok(meta)) => Ok(Some(meta)),
    }
}

async fn read_inventory_file(file: &str) -> AppResult<Value> {
    let path = file.to_string();
    let read = tokio::time::timeout(Duration::from_millis(12000), tokio::fs::read(&path)).await;
    match read {
        Err(_) => Err(AppError::new(format!("Agent heartbeat read on {path}: timed out after 12 seconds"))),
        Ok(Err(error)) => Err(AppError::new(error.to_string())),
        Ok(Ok(bytes)) => {
            if bytes.len() as u64 > MAX_INVENTORY_BYTES {
                return Err(AppError::new("Agent inventory is too large"));
            }
            let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or(0);
            validate_snapshot(&String::from_utf8_lossy(&bytes), now)
        }
    }
}

impl StoreAgentService {
    pub fn new(source_path: PathBuf, smb: Arc<SmbSessionManager>, get_credentials: Box<dyn Fn() -> Value + Send + Sync>) -> Self {
        Self {
            source_path,
            control: AgentControl::new(),
            smb,
            get_credentials,
            locks: Arc::new(parking_lot::Mutex::new(HashMap::new())),
            heartbeat_wait_ms: 45000,
        }
    }

    pub async fn inspect(&self, host: &str) -> Value {
        let result: AppResult<Value> = async {
            let exe = map_path(host, AGENT_EXE);
            let exe_meta = optional_stat(&exe).await?;
            match &exe_meta {
                Some(meta) if meta.is_file() && !meta.is_symlink() => {}
                _ => return Ok(json!({ "running": false, "reason": "Agent executable is missing; use Import Agent" })),
            }
            let service = self.control.query(host).await?;
            if !service.get("exists").and_then(Value::as_bool).unwrap_or(false)
                || service.get("state").and_then(Value::as_str) != Some("Running")
            {
                let state = service.get("state").and_then(Value::as_str).unwrap_or("not installed");
                return Ok(json!({ "running": false, "reason": format!("Agent service is {state}; use Import Agent to start it") }));
            }
            let file = map_path(host, "data/inventory.json");
            let meta = optional_stat(&file).await?;
            match &meta {
                Some(entry) if entry.is_file() && !entry.is_symlink() && entry.len() <= MAX_INVENTORY_BYTES => {}
                _ => return Ok(json!({ "running": false, "reason": "Agent has not produced a readable heartbeat yet" })),
            }
            let data = read_inventory_file(&file).await?;
            let mut merged = json!({ "running": true });
            if let (Value::Object(base), Value::Object(additions)) = (&mut merged, &data) {
                for (key, value) in additions {
                    base.insert(key.clone(), value.clone());
                }
            }
            Ok(merged)
        }
        .await;
        match result {
            Ok(value) => value,
            Err(error) => json!({ "running": false, "reason": error.message }),
        }
    }

    async fn wait_for_heartbeat(&self, host: &str, expected_hash: &str, emitter: &Option<Emitter>, checkout_id: Value, name: Value) -> AppResult<Value> {
        let end = Instant::now() + Duration::from_millis(self.heartbeat_wait_ms);
        loop {
            let result = self.inspect(host).await;
            if result.get("running").and_then(Value::as_bool).unwrap_or(false) {
                let verify_label = format!("Verifying running agent SHA-256 on {host}");
                let actual = crate::services::agent_transfer::hash_file(
                    PathBuf::from(map_path(host, AGENT_EXE)).as_path(),
                    &verify_label,
                    emitter.clone(),
                )
                .await?;
                if actual != expected_hash {
                    return Err(AppError::new("Agent SHA-256 changed after installation"));
                }
                let latest = self.inspect(host).await;
                if !latest.get("running").and_then(Value::as_bool).unwrap_or(false) {
                    let reason = latest.get("reason").and_then(Value::as_str).unwrap_or("no fresh heartbeat");
                    return Err(AppError::new(format!("Agent stopped responding during final SHA-256 verification on {host}: {reason}")));
                }
                return Ok(latest);
            }
            if Instant::now() >= end {
                return Err(AppError::new(
                    "Agent service started but no fresh heartbeat arrived; check C:\\Agent\\data permissions and the checkout clock",
                ));
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
            let _ = (&checkout_id, &name);
        }
    }

    pub async fn import_one(&self, checkout: &Value, emitter: &Option<Emitter>) -> Value {
        let started = Instant::now();
        let checkout_id = checkout.get("id").cloned().unwrap_or(Value::Null);
        let name = checkout.get("name").cloned().unwrap_or(Value::Null);
        let steps: std::sync::Arc<parking_lot::Mutex<Vec<Value>>> = Default::default();
        let record = |step: &str, detail: &str, progress: Option<Value>| {
            let entry = json!({
                "step": step, "detail": detail,
                "at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                "progress": progress
            });
            let mut list = steps.lock();
            let replace = progress.is_some()
                && list.last().map(|last| last.get("progress").map(|value| !value.is_null()).unwrap_or(false) && last.get("step").and_then(Value::as_str) == Some(step)).unwrap_or(false);
            if replace {
                let length = list.len();
                list[length - 1] = entry.clone();
            } else {
                list.push(entry.clone());
            }
            if let Some(emitter) = emitter {
                let mut event = json!({ "checkoutId": checkout_id, "name": name });
                if let (Value::Object(base), Value::Object(additions)) = (&mut event, &entry) {
                    for (key, value) in additions {
                        base.insert(key.clone(), value.clone());
                    }
                }
                emitter("store-update:agent-step", event);
            }
        };
        let outcome: AppResult<Value> = async {
            if !cfg!(windows) {
                return Err(AppError::new("Agent import is only available on Windows"));
            }
            let requested_raw = checkout.get("ip").and_then(Value::as_str).filter(|text| !text.is_empty()).unwrap_or_else(|| checkout.get("hostname").and_then(Value::as_str).unwrap_or(""));
            let requested = normalize_host(requested_raw)?;
            let reachable = check_reachable(&requested, Some(vec![checkout.get("ip").and_then(Value::as_str).unwrap_or("").to_string(), checkout.get("hostname").and_then(Value::as_str).unwrap_or("").to_string()]), crate::services::reachability::SMB_PORT, 3000).await;
            if reachable.get("status").and_then(Value::as_str) == Some("offline") {
                let detail = reachable.get("detail").and_then(Value::as_str).unwrap_or("Checkout is unreachable");
                return Err(AppError::new(detail.to_string()));
            }
            let host = normalize_host(reachable.get("host").and_then(Value::as_str).unwrap_or(&requested))?;
            let key = host.to_lowercase();
            {
                let mut locks = self.locks.lock();
                if locks.contains_key(&key) {
                    return Err(AppError::new("An agent import is already running on this checkout"));
                }
                locks.insert(key.clone(), ());
            }
            let result = self.install(&host, &record, emitter).await;
            self.locks.lock().remove(&key);
            let payload = result?;
            let mut merged = json!({
                "checkoutId": checkout_id, "name": name, "host": host, "ok": true,
                "durationMs": started.elapsed().as_millis() as u64
            });
            if let (Value::Object(base), Value::Object(additions)) = (&mut merged, &payload) {
                for (key, value) in additions {
                    base.insert(key.clone(), value.clone());
                }
            }
            merged["steps"] = json!(steps.lock().clone());
            Ok(merged)
        }
        .await;
        match outcome {
            Ok(value) => value,
            Err(error) => {
                record("failed", &error.message, None);
                json!({
                    "checkoutId": checkout_id, "name": name, "ok": false,
                    "error": error.message,
                    "steps": steps.lock().clone(),
                    "durationMs": started.elapsed().as_millis() as u64
                })
            }
        }
    }

    async fn install(&self, host: &str, record: &dyn Fn(&str, &str, Option<Value>), emitter: &Option<Emitter>) -> AppResult<Value> {
        record("source-check", &format!("Checking the bundled agent before import to {host}"), None);
        let source_meta = tokio::fs::metadata(&self.source_path).await.ok();
        let Some(source_meta) = source_meta else {
            return Err(AppError::new("The bundled agent EXE is missing. Install the full desktop package or run npm run build:agent"));
        };
        if !source_meta.is_file() {
            return Err(AppError::new("The bundled agent EXE is missing. Install the full desktop package or run npm run build:agent"));
        }
        let source_size = source_meta.len();
        let source = self.source_path.clone();

        let hash_label = format!("Hashing bundled agent for {host}");
        let expected_hash = crate::services::agent_transfer::hash_file(&source, &hash_label, emitter.clone()).await?;
        record("source", &format!("Bundled agent SHA-256: {expected_hash}"), None);
        let target = map_path(host, AGENT_EXE);
        let directory = map_path(host, "");
        let data_directory = map_path(host, "data");
        record("target", &format!("Checking agent paths and permissions on {host}"), None);
        for file in [&directory, &data_directory, &target] {
            if let Some(meta) = optional_stat(file).await? {
                if meta.is_symlink() {
                    return Err(AppError::new("Agent files/directories must not be symlinks or junctions"));
                }
            }
        }
        tokio::fs::create_dir_all(&data_directory).await.map_err(|error| AppError::new(error.to_string()))?;
        record("permissions", &format!("Preparing protected agent directories on {host}"), None);
        self.control.secure_directories(host).await?;

        // An exclusive on-target lock also protects imports from OTHER workstations.
        let lock_path = map_path(host, "import.lock");
        record("lock", &format!("Acquiring the agent import lock on {host}"), None);
        match tokio::fs::OpenOptions::new().write(true).create_new(true).open(&lock_path).await {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(AppError::new(
                    "Agent import is locked on the target. Wait for the other importer; if it crashed, have IT remove C:\\Agent\\import.lock",
                ));
            }
            Err(error) => return Err(AppError::new(error.to_string())),
        }
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let stage = map_path(host, &format!("{AGENT_EXE}.{nonce}.new"));
        let backup = map_path(host, &format!("{AGENT_EXE}.{nonce}.previous"));
        let mut backed_up = false;
        let mut replaced = false;
        let mut service_touched = false;
        let mut created_service = false;
        let mut complete = false;
        let previous = self.control.query(host).await?;
        let result: AppResult<Value> = async {
            record("service-check", &format!("Checking the existing Windows agent service on {host}"), None);
            let previous_exists = previous.get("exists").and_then(Value::as_bool).unwrap_or(false);
            let previous_state = previous.get("state").and_then(Value::as_str).unwrap_or("Missing").to_string();
            if previous_exists {
                self.control.assert_owned_service(host).await?;
            }
            let target_meta = optional_stat(&target).await?;
            if let Some(meta) = &target_meta {
                if !meta.is_file() {
                    return Err(AppError::new("The agent executable path is not a regular file"));
                }
            }
            let installed_hash = match &target_meta {
                Some(_) => {
                    let size = target_meta.as_ref().map(|meta| meta.len()).unwrap_or(0);
                    record("compare-hash", &format!("Reading installed agent SHA-256 over SMB from {host} ({size} bytes); slow but progressing reads are allowed"), None);
                    let label = format!("Reading installed agent SHA-256 on {host}");
                    Some(crate::services::agent_transfer::hash_file(PathBuf::from(target.clone()).as_path(), &label, emitter.clone()).await?)
                }
                None => None,
            };
            let copied = installed_hash.as_deref() != Some(expected_hash.as_str());
            record(
                "compare",
                match &installed_hash {
                    Some(_) => {
                        if copied {
                            "SHA-256 mismatch — replacement required"
                        } else {
                            "SHA-256 matches — copy skipped"
                        }
                    }
                    None => "Agent EXE is missing — copy required",
                },
                None,
            );
            if copied {
                record("copy", &format!("Copying the staged agent to {host}"), None);
                let label = format!("Copying staged agent to {host}");
                crate::services::agent_transfer::copy_file(&source, PathBuf::from(stage.clone()).as_path(), &label, emitter.clone()).await?;
                record("verify-copy", &format!("Reading back the staged copy from {host} to verify SHA-256"), None);
                let verify_label = format!("Verifying staged agent SHA-256 on {host}");
                let staged_hash = crate::services::agent_transfer::hash_file(PathBuf::from(stage.clone()).as_path(), &verify_label, emitter.clone()).await?;
                if staged_hash != expected_hash {
                    return Err(AppError::new("Copied agent failed SHA-256 verification; the existing service was not changed"));
                }
                record("copy", "Staged agent copied and SHA-256 verified", None);
            }
            // Stop even on a matching binary to apply the least-privilege account and
            // automatic startup consistently, without copying the EXE again.
            if previous_exists {
                record("stop", &format!("Stopping the verified agent service on {host}"), None);
                service_touched = true;
                self.control.stop(host).await?;
            }
            // Remove old data so a successful restart cannot pass on an old heartbeat.
            let inventory_file = map_path(host, "data/inventory.json");
            match tokio::fs::remove_file(&inventory_file).await {
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(AppError::new(error.to_string())),
            }
            if copied {
                if target_meta.is_some() {
                    tokio::fs::rename(&target, &backup).await.map_err(|error| AppError::new(error.to_string()))?;
                    backed_up = true;
                }
                tokio::fs::rename(&stage, &target).await.map_err(|error| AppError::new(error.to_string()))?;
                replaced = true;
            }
            service_touched = true;
            // Mark before create: configuration can fail AFTER create succeeded.
            created_service = !previous_exists;
            record("configure", &format!("Configuring the automatic agent service on {host}"), None);
            self.control.configure(host, previous_exists).await?;
            record("startup", "Windows Service configured: Automatic startup, LocalService account, failure recovery", None);
            self.control.start(host).await?;
            record("heartbeat", &format!("Waiting for a fresh agent heartbeat from {host}; final SHA-256 verification follows"), None);
            let heartbeat = self.wait_for_heartbeat(host, &expected_hash, emitter, Value::Null, Value::Null).await?;
            record("running", "Service is Running and a fresh agent heartbeat was verified", None);
            complete = true;
            if backed_up {
                let _ = tokio::fs::remove_file(&backup).await;
            }
            Ok(json!({
                "copied": copied,
                "sha256": expected_hash,
                "agentVersion": heartbeat.get("agentVersion").cloned().unwrap_or(Value::Null),
                "state": "running"
            }))
        }
        .await;

        if let Err(error) = result {
            if service_touched || replaced || backed_up {
                let rollback = async {
                    self.control.stop(host).await?;
                    if replaced {
                        let _ = tokio::fs::remove_file(&target).await;
                    }
                    if backed_up {
                        tokio::fs::rename(&backup, &target).await?;
                        backed_up = false;
                    }
                    if created_service {
                        self.control.remove(host).await?;
                    } else if previous.get("state").and_then(Value::as_str) == Some("Running") {
                        self.control.start(host).await?;
                    }
                    record("rollback", "Previous executable/service restored where present", None);
                    Ok::<(), AppError>(())
                };
                if let Err(rollback_error) = rollback.await {
                    return Err(AppError::new(format!(
                        "{}. Rollback needs administrator attention: {}{}",
                        error.message,
                        rollback_error.message,
                        if backed_up { format!("; preserved binary: {backup}") } else { String::new() }
                    )));
                }
            }
            let _ = tokio::fs::remove_file(&stage).await;
            let _ = tokio::fs::remove_file(&lock_path).await;
            if !complete {
                record("import", "Import did not complete; inspect the failure details", None);
            }
            return Err(error);
        }
        let _ = tokio::fs::remove_file(&stage).await;
        let _ = tokio::fs::remove_file(&lock_path).await;
        if !complete {
            record("import", "Import did not complete; inspect the failure details", None);
        }
        Ok(json!({}))
    }

    pub async fn import_all(&self, checkouts: &[Value], emitter: &Option<Emitter>) -> Value {
        let mut results: Vec<Value> = Vec::new();
        for checkout in checkouts {
            results.push(self.import_one(checkout, emitter).await);
        }
        let ok = results.iter().filter(|row| row.get("ok").and_then(Value::as_bool).unwrap_or(false)).count();
        json!({
            "total": results.len(),
            "ok": ok,
            "failed": results.len() - ok,
            "results": results
        })
    }
}
