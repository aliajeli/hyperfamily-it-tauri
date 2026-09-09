//! Port of electron/services/store-update.service.js — "Update Store App":
//! version sweeps over agent heartbeats and the verified Jalali-dated
//! deployment pipeline (reach → sign-in → backup → copy → SHA-256 → retry).

use crate::error::{AppError, AppResult};
use crate::services::reachability::check_reachable;
use crate::services::registry::pick_program;
use crate::services::store_agent::StoreAgentService;
use crate::services::{software::sha256_file, Emitter};
use chrono::Datelike;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const STORE_COMMERCE_PROGRAM: &str = "Store Commerce";
const REACH_TIMEOUT_MS: u64 = 3000;
const CHECK_TIMEOUT_MS: u64 = 60_000;
const COPY_TIMEOUT_MS: u64 = 15 * 60 * 1000;
const MAX_COPY_ATTEMPTS: usize = 3;

/// Narrated step recorder shared into the session task future.
pub type StepRecorder = Arc<dyn Fn(&str, &str, &str) + Send + Sync>;

/* -------------------------------------------------------------------------- */
/* Jalali (Persian) dates: backups are renamed `<jalali YYYYMMDD>-<name>`.     */
/* -------------------------------------------------------------------------- */

fn div(a: i64, b: i64) -> i64 {
    a / b
}

/// Gregorian → Jalali (algorithmic Solar Hijri, the widely used jalaali
/// conversion). Only used for human-readable backup file stamps.
pub fn to_jalali(gy: i64, gm: i64, gd: i64) -> (i64, i64, i64) {
    let g_d_m = [0i64, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let mut jy: i64 = if gy <= 1600 { 0 } else { 979 };
    let gy = gy - if gy <= 1600 { 621 } else { 1600 };
    let gy2 = if gm > 2 { gy + 1 } else { gy };
    let mut days: i64 = (365 * gy) + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) - 80 + gd
        + g_d_m[(gm.clamp(1, 12) - 1) as usize];
    jy += 33 * div(days, 12053);
    days %= 12053;
    jy += 4 * div(days, 1461);
    days %= 1461;
    if days > 365 {
        jy += div(days - 1, 365);
        days = (days - 1) % 365;
    }
    let jm = if days < 186 { 1 + div(days, 31) } else { 7 + div(days - 186, 30) };
    let jd = if days < 186 { 1 + days % 31 } else { 1 + (days - 186) % 30 };
    (jy, jm, jd)
}

/// Today (local machine date) → `14050617`, stamped onto backed-up files.
pub fn jalali_stamp() -> String {
    let now = chrono::Local::now();
    let (jy, jm, jd) = to_jalali(now.year() as i64, now.month() as i64, now.day() as i64);
    format!("{jy}{jm:02}{jd:02}")
}

/// 'D:\Store\app.exe' on host CO-01 → '\\CO-01\D$\Store\app.exe'.
pub fn unc_path(host: &str, local_path: &str) -> AppResult<String> {
    let clean_host: String = host.trim().trim_start_matches('\\').split(['\\', '/']).next().unwrap_or("").to_string();
    if clean_host.is_empty() {
        return Err(AppError::new("The checkout has no hostname or IP address"));
    }
    let value = local_path.trim();
    let pattern = regex::Regex::new(r"^([a-zA-Z]):[/\\](.+)$").expect("static regex");
    let Some(captures) = pattern.captures(value) else {
        return Err(AppError::new(format!("Path must be a local drive path like C:\\Store\\app.exe — got \u{201c}{value}\u{201d}")));
    };
    let drive = captures.get(1).map(|m| m.as_str().to_uppercase()).unwrap_or_default();
    let rest = captures.get(2).map(|m| m.as_str().replace('/', "\\")).unwrap_or_default();
    Ok(format!(r"\\{clean_host}\{drive}$\{rest}"))
}

async fn remote_exists(path: &str) -> bool {
    tokio::fs::metadata(path).await.is_ok()
}

/// Free backup name `<stamp>-<file>` inside `dir` (`-2`, `-3`… on collision).
async fn pick_backup_name(dir: &str, file_name: &str, stamp: &str) -> String {
    let mut candidate = format!("{stamp}-{file_name}");
    let mut counter = 2;
    let replace_pattern = regex::Regex::new(r"(\.[^.]*)?$").expect("static regex");
    while remote_exists(&format!("{dir}\\{candidate}")).await {
        let replaced = replace_pattern.replace(file_name, &format!("-{counter}$1")).to_string();
        candidate = format!("{stamp}-{replaced}");
        counter += 1;
    }
    candidate
}

/// Owned snapshot of the service knobs a version check needs.
struct CheckContext {
    smb: Arc<crate::services::smb::SmbSessionManager>,
    agent: Arc<StoreAgentService>,
    credentials: Value,
    program_name: String,
}

pub struct StoreUpdateService {
    pub smb: Arc<crate::services::smb::SmbSessionManager>,
    pub agent: Arc<StoreAgentService>,
    pub get_credentials: Box<dyn Fn() -> Value + Send + Sync>,
    pub get_program_name: Box<dyn Fn() -> String + Send + Sync>,
}

impl StoreUpdateService {
    pub fn new(
        smb: Arc<crate::services::smb::SmbSessionManager>,
        agent: Arc<StoreAgentService>,
        get_credentials: Box<dyn Fn() -> Value + Send + Sync>,
        get_program_name: Box<dyn Fn() -> String + Send + Sync>,
    ) -> Self {
        Self { smb, agent, get_credentials, get_program_name }
    }

    pub fn program_name(&self) -> String {
        let configured = (self.get_program_name)().trim().to_string();
        if configured.is_empty() {
            STORE_COMMERCE_PROGRAM.to_string()
        } else {
            configured
        }
    }

    fn host_of(checkout: &Value) -> String {
        checkout
            .get("ip")
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
            .or_else(|| checkout.get("hostname").and_then(Value::as_str))
            .unwrap_or("")
            .trim()
            .to_string()
    }

    fn label_of(checkout: &Value) -> String {
        let name = checkout.get("hostname").and_then(Value::as_str).unwrap_or("").trim();
        let ip = checkout.get("ip").and_then(Value::as_str).unwrap_or("").trim();
        if !name.is_empty() && !ip.is_empty() && name != ip {
            format!("{name} ({ip})")
        } else if !name.is_empty() {
            name.to_string()
        } else if !ip.is_empty() {
            ip.to_string()
        } else {
            "checkout".to_string()
        }
    }

    fn candidates(checkout: &Value) -> Vec<String> {
        vec![
            checkout.get("ip").and_then(Value::as_str).unwrap_or("").to_string(),
            checkout.get("hostname").and_then(Value::as_str).unwrap_or("").to_string(),
        ]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect()
    }

    /// Everything `check_one` needs, in an owned form so version sweeps can
    /// run concurrently across spawned tasks.
    fn check_context(&self) -> CheckContext {
        CheckContext {
            smb: self.smb.clone(),
            agent: self.agent.clone(),
            credentials: (self.get_credentials)(),
            program_name: self.program_name(),
        }
    }

    /// Agent presence, SCM state and heartbeat are checked before any version.
    pub async fn check_one(&self, checkout: &Value) -> Value {
        Self::check_one_with(&self.check_context(), checkout).await
    }

    async fn check_one_with(ctx: &CheckContext, checkout: &Value) -> Value {
        let host = Self::host_of(checkout);
        if host.is_empty() {
            return json!({ "state": "no-host", "detail": "No hostname or IP on record" });
        }
        let started = Instant::now();
        let reach = check_reachable(&host, Some(Self::candidates(checkout)), crate::services::reachability::SMB_PORT, REACH_TIMEOUT_MS).await;
        let checked_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        if reach.get("status").and_then(Value::as_str) == Some("offline") {
            return json!({
                "state": "offline", "host": host,
                "detail": reach.get("detail").cloned().unwrap_or(Value::Null),
                "icmp": reach.get("icmp").cloned().unwrap_or(Value::Null),
                "smb": false, "checkedAt": checked_at
            });
        }
        let address = reach.get("host").and_then(Value::as_str).unwrap_or(&host).to_string();
        let base = json!({
            "host": address, "label": Self::label_of(checkout),
            "pingTime": reach.get("ping_time").cloned().unwrap_or(Value::Null),
            "icmp": reach.get("icmp").cloned().unwrap_or(Value::Null),
            "smb": true, "checkedAt": checked_at
        });
        let outcome: AppResult<Value> = async {
            let credentials = ctx.credentials.clone();
            let agent = ctx.agent.clone();
            let address_for_task = address.clone();
            let checked = tokio::time::timeout(
                Duration::from_millis(CHECK_TIMEOUT_MS),
                ctx.smb.with_host(&address, &credentials, async move {
                    Ok(agent.inspect(&address_for_task).await)
                }),
            )
            .await
            .map_err(|_| AppError::new(format!("{} did not return its installed programs in time", Self::label_of(checkout))))??;
            if !checked.get("running").and_then(Value::as_bool).unwrap_or(false) {
                let reason = checked.get("reason").and_then(Value::as_str).unwrap_or("Agent is not running").to_string();
                let mut result = base.clone();
                result["state"] = json!("agent-not-running");
                result["detail"] = json!(reason);
                return Ok(result);
            }
            let programs = checked.get("programs").cloned().unwrap_or(json!([]));
            let program = pick_program(programs.as_array().map(Vec::as_slice).unwrap_or(&[]), ctx.program_name.as_str());
            let Some(program) = program else {
                let mut result = base.clone();
                result["state"] = json!("not-found");
                result["source"] = json!("agent");
                result["detail"] = json!(format!(
                    "\u{201c}{}\u{201d} is not listed in the agent's current Programs and Features inventory",
                    ctx.program_name.as_str()
                ));
                result["installedCount"] = json!(programs.as_array().map(Vec::len).unwrap_or(0));
                return Ok(result);
            };
            let mut result = base.clone();
            result["state"] = json!("ok");
            result["version"] = json!(program
                .get("version")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .unwrap_or("unknown"));
            result["product"] = program.get("name").cloned().unwrap_or(Value::Null);
            result["publisher"] = program.get("publisher").cloned().unwrap_or(Value::Null);
            result["installLocation"] = program.get("installLocation").cloned().unwrap_or(Value::Null);
            result["source"] = json!("agent");
            result["stale"] = json!(false);
            result["agentVersion"] = checked.get("agentVersion").cloned().unwrap_or(Value::Null);
            result["inventoryAt"] = checked.get("generatedAt").cloned().unwrap_or(Value::Null);
            result["durationMs"] = json!(started.elapsed().as_millis() as u64);
            Ok(result)
        }
        .await;
        match outcome {
            Ok(value) => value,
            Err(error) => {
                let mut result = base;
                result["state"] = json!("error");
                result["error"] = json!(error.message);
                result["durationMs"] = json!(started.elapsed().as_millis() as u64);
                result
            }
        }
    }

    /// Every program in Programs and Features on ONE checkout.
    pub async fn list_installed_on(&self, checkout: &Value) -> AppResult<Value> {
        let host = Self::host_of(checkout);
        if host.is_empty() {
            return Err(AppError::new("This checkout has no hostname or IP address on record"));
        }
        let reach = check_reachable(&host, Some(Self::candidates(checkout)), crate::services::reachability::SMB_PORT, REACH_TIMEOUT_MS).await;
        if reach.get("status").and_then(Value::as_str) == Some("offline") {
            let detail = reach.get("detail").and_then(Value::as_str).unwrap_or("not reachable").to_string();
            return Err(AppError::new(format!("{host} — {detail}")));
        }
        let address = reach.get("host").and_then(Value::as_str).unwrap_or(&host).to_string();
        let credentials = (self.get_credentials)();
        let agent = self.agent.clone();
        let address_for_task = address.clone();
        let inventory = tokio::time::timeout(
            Duration::from_millis(CHECK_TIMEOUT_MS),
            self.smb.with_host(&address, &credentials, async move {
                Ok(agent.inspect(&address_for_task).await)
            }),
        )
        .await
        .map_err(|_| AppError::new(format!("{} did not return its installed programs in time", Self::label_of(checkout))))??;
        if !inventory.get("running").and_then(Value::as_bool).unwrap_or(false) {
            let reason = inventory.get("reason").and_then(Value::as_str).unwrap_or("Import Agent to install/start the service");
            return Err(AppError::new(format!("Agent is not running — {reason}")));
        }
        let programs = inventory.get("programs").cloned().unwrap_or(json!([]));
        let match_value = pick_program(programs.as_array().map(Vec::as_slice).unwrap_or(&[]), self.program_name().as_str());
        Ok(json!({
            "host": address,
            "label": Self::label_of(checkout),
            "source": "agent",
            "stale": false,
            "programs": programs,
            "total": programs.as_array().map(Vec::len).unwrap_or(0),
            "configuredName": self.program_name(),
            "match": match_value.map(|entry| json!({
                "name": entry.get("name").cloned().unwrap_or(Value::Null),
                "version": entry.get("version").cloned().unwrap_or(Value::Null)
            }))
        }))
    }

    /// Version sweep over ALL checkouts with a small worker pool (5 at a
    /// time); every finished checkout is emitted immediately as
    /// `store-update:version` and results keep the input order.
    pub async fn check_many(&self, checkouts: &[Value], emitter: &Option<Emitter>) -> Vec<Value> {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let ctx = Arc::new(self.check_context());
        let semaphore = Arc::new(tokio::sync::Semaphore::new(std::cmp::min(5, checkouts.len().max(1))));
        let next_index = Arc::new(AtomicUsize::new(0));
        let mut set = tokio::task::JoinSet::new();
        for checkout in checkouts {
            let ctx = ctx.clone();
            let semaphore = semaphore.clone();
            let next_index = next_index.clone();
            let checkout = checkout.clone();
            let emitter = emitter.clone();
            set.spawn(async move {
                let _permit = semaphore.acquire().await;
                let index = next_index.fetch_add(1, Ordering::SeqCst);
                let result = Self::check_one_with(&ctx, &checkout).await;
                let mut full = json!({
                    "checkoutId": checkout.get("id").cloned().unwrap_or(Value::Null),
                    "name": checkout.get("name").cloned().unwrap_or(Value::Null),
                    "branchId": checkout.get("branch_id").cloned().unwrap_or(Value::Null)
                });
                if let (Value::Object(base), Value::Object(additions)) = (&mut full, &result) {
                    for (key, value) in additions {
                        base.insert(key.clone(), value.clone());
                    }
                }
                if let Some(emitter) = &emitter {
                    emitter("store-update:version", full.clone());
                }
                (index, full)
            });
        }
        let mut ordered: Vec<Option<Value>> = vec![None; checkouts.len()];
        while let Some(joined) = set.join_next().await {
            if let Ok((index, full)) = joined {
                if index < ordered.len() {
                    ordered[index] = Some(full);
                }
            }
        }
        ordered.into_iter().flatten().collect()
    }

    /// The full deployment pipeline for ONE checkout, narrated through
    /// `store-update:step` events. The authenticated SMB session covers the
    /// whole pipeline and is released automatically at the end.
    pub async fn deploy_one(
        &self,
        checkout: &Value,
        source: &str,
        destination_path: &str,
        run_id: &str,
        stamp: Option<String>,
        emitter: &Option<Emitter>,
    ) -> Value {
        let host = Self::host_of(checkout);
        let started = Instant::now();
        let steps: Arc<parking_lot::Mutex<Vec<Value>>> = Default::default();
        let checkout_id = checkout.get("id").cloned().unwrap_or(Value::Null);
        let checkout_name = checkout.get("name").cloned().unwrap_or(Value::Null);
        let label = Self::label_of(checkout);
        let record: StepRecorder = {
            let steps = steps.clone();
            let emitter = emitter.clone();
            let run_id = run_id.to_string();
            let checkout_id = checkout_id.clone();
            let checkout_name = checkout_name.clone();
            Arc::new(move |step: &str, status: &str, detail: &str| {
                let at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                steps.lock().push(json!({ "step": step, "status": status, "detail": detail, "at": at }));
                if let Some(emitter) = &emitter {
                    emitter(
                        "store-update:step",
                        json!({ "runId": run_id, "checkoutId": checkout_id, "name": checkout_name,
                                "step": step, "status": status, "detail": detail, "at": at }),
                    );
                }
            })
        };
        let make_finish = |ok: bool, extra: Value| {
            let mut result = json!({
                "checkoutId": checkout_id, "name": checkout_name, "host": host, "ok": ok,
                "steps": steps.lock().clone(),
                "durationMs": started.elapsed().as_millis() as u64
            });
            if let (Value::Object(base), Value::Object(additions)) = (&mut result, &extra) {
                for (key, value) in additions {
                    base.insert(key.clone(), value.clone());
                }
            }
            result
        };

        let file_name = Path::new(source).file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
        if file_name.is_empty() {
            record("source", "failed", "No file selected");
            return make_finish(false, json!({ "error": "Selected file missing" }));
        }
        let source_size = match tokio::fs::metadata(source).await {
            Ok(meta) => meta.len(),
            Err(_) => {
                record("source", "failed", "The selected file no longer exists on this system");
                return make_finish(false, json!({ "error": "Selected file missing" }));
            }
        };
        record("source", "done", &format!("{file_name} ({source_size} bytes)"));
        if host.is_empty() {
            record("connectivity", "failed", "The checkout has no hostname or IP address");
            return make_finish(false, json!({ "error": "No host" }));
        }

        // 1 --- connectivity: checked against SMB (port 445), never ICMP.
        record("connectivity", "running", &format!("Checking file sharing on {label}…"));
        let reach = check_reachable(&host, Some(Self::candidates(checkout)), crate::services::reachability::SMB_PORT, REACH_TIMEOUT_MS).await;
        if reach.get("status").and_then(Value::as_str) == Some("offline") {
            let detail = reach.get("detail").and_then(Value::as_str).unwrap_or("not reachable over SMB").to_string();
            record("connectivity", "failed", &detail);
            return make_finish(false, json!({ "error": "Checkout unreachable" }));
        }
        let ping = reach.get("ping_time").cloned().unwrap_or(json!(1));
        record(
            "connectivity",
            "done",
            &reach
                .get("detail")
                .and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| format!("{host} answered in {ping} ms")),
        );
        let address = reach.get("host").and_then(Value::as_str).unwrap_or(&host).to_string();

        let credentials = (self.get_credentials)();
        let credentials_user = credentials.get("username").and_then(Value::as_str).unwrap_or("").to_string();
        let credentials_domain = credentials.get("domain").and_then(Value::as_str).unwrap_or("").to_string();
        if !credentials_user.is_empty() {
            let prefix = if credentials_domain.is_empty() { String::new() } else { format!("{credentials_domain}\\") };
            record("signin", "running", &format!("Signing in to {address} as {prefix}{credentials_user}…"));
        }

        let pipeline: AppResult<Value> = self
            .smb
            .with_host(&address, &credentials, {
                let source = source.to_string();
                let destination_path = destination_path.to_string();
                let stamp = stamp.clone();
                let file_name = file_name.clone();
                let address = address.clone();
                let label = label.clone();
                let record = record.clone();
                let emitter = emitter.clone();
                let checkout_id = checkout_id.clone();
                let checkout_name = checkout_name.clone();
                async move {
                    if !credentials_user.is_empty() {
                        record("signin", "done", &format!("Authenticated to {address}"));
                    }
                    run_pipeline(
                        self, &source, &destination_path, &file_name, source_size, stamp, run_id, &emitter, &record,
                        checkout_id, checkout_name, &address, &label,
                    )
                    .await
                }
            })
            .await;
        match pipeline {
            Ok(payload) => {
                let mut result = json!({
                    "checkoutId": checkout_id, "name": checkout_name, "host": host,
                    "steps": steps.lock().clone(),
                    "durationMs": started.elapsed().as_millis() as u64
                });
                if let (Value::Object(base), Value::Object(additions)) = (&mut result, &payload) {
                    for (key, value) in additions {
                        base.insert(key.clone(), value.clone());
                    }
                }
                result
            }
            Err(error) => {
                // Session setup failed (wrong credentials, host refuses SMB, …).
                record("signin", "failed", &error.message);
                make_finish(false, json!({ "error": error.message }))
            }
        }
    }

    /// Deploys to every checkout STRICTLY in list order, ending with a
    /// `store-update:finished` event carrying the per-machine summary.
    pub async fn deploy_all(&self, checkouts: &[Value], source: &str, destination_path: &str, emitter: &Option<Emitter>) -> Value {
        let run_id = format!("run-{}-{}", chrono::Utc::now().timestamp_millis(), &uuid::Uuid::new_v4().simple().to_string()[..6]);
        let stamp = jalali_stamp();
        let mut results: Vec<Value> = Vec::new();
        for checkout in checkouts {
            // Serial on purpose: operators watch each machine finish before the next starts.
            results.push(self.deploy_one(checkout, source, destination_path, &run_id, Some(stamp.clone()), emitter).await);
        }
        let total = results.len();
        let ok = results.iter().filter(|row| row.get("ok").and_then(Value::as_bool).unwrap_or(false)).count();
        let duration: u64 = results.iter().filter_map(|row| row.get("durationMs").and_then(Value::as_u64)).sum();
        let summary = json!({
            "runId": run_id, "total": total, "ok": ok, "failed": total - ok,
            "results": results, "durationMs": duration
        });
        if let Some(emitter) = emitter {
            emitter("store-update:finished", summary.clone());
        }
        summary
    }
}

/// The copy pipeline body that runs inside the authenticated SMB session.
/// Every failure path returns a fully-shaped `finish(false, …)` value, so the
/// only `Err` escape is the session setup itself.
#[allow(clippy::too_many_arguments)]
async fn run_pipeline(
    service: &StoreUpdateService,
    source: &str,
    destination_path: &str,
    file_name: &str,
    source_size: u64,
    stamp: Option<String>,
    run_id: &str,
    emitter: &Option<Emitter>,
    record: &StepRecorder,
    checkout_id: Value,
    checkout_name: Value,
    address: &str,
    _label: &str,
) -> Result<Value, AppError> {
    // NOTE: the finish payload with the live steps list is assembled by the
    // caller (deploy_one) — this function returns either the success payload
    // or a failure payload; the caller merges steps + timing.
    let _ = address;

    // 2 --- resolve target ---
    let dest_dir = match unc_path(address, destination_path) {
        Ok(value) => value,
        Err(error) => {
            record("target", "failed", &error.message);
            return Ok(fail_value(error.message));
        }
    };
    let target = format!("{dest_dir}\\{file_name}");
    match tokio::fs::create_dir_all(&dest_dir).await {
        Ok(_) => record("target", "done", &format!("{dest_dir}\\{file_name}")),
        Err(error) => {
            record("target", "failed", &error.to_string());
            return Ok(fail_value(error.to_string()));
        }
    }

    // 3 --- existing file → dated backup ---
    let mut backup_name: Option<String> = None;
    match tokio::fs::metadata(&target).await {
        Ok(_) => {
            let stamp = stamp.unwrap_or_else(jalali_stamp);
            let candidate = pick_backup_name(&dest_dir, file_name, &stamp).await;
            match tokio::fs::rename(&target, format!("{dest_dir}\\{candidate}")).await {
                Ok(_) => {
                    record("backup", "done", &format!("{file_name} → {candidate}"));
                    backup_name = Some(candidate);
                }
                Err(error) => {
                    record("backup", "failed", &format!("Could not rename the existing file — {error}"));
                    let mut extra = fail_value("Backup rename failed".to_string());
                    extra["backup"] = backup_name.clone().into();
                    return Ok(extra);
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            record("backup", "skipped", &format!("{target} does not exist yet — nothing to back up"));
        }
        Err(error) => {
            record("backup", "failed", &format!("Could not reach {target} — {error}"));
            let mut extra = fail_value("Backup rename failed".to_string());
            extra["backup"] = backup_name.clone().into();
            return Ok(extra);
        }
    }

    // 4-6 --- copy + SHA-256 verify, with delete-and-retry ---
    let source_hash = match sha256_file(Path::new(source)).await {
        Ok(hash) => hash,
        Err(error) => {
            record("copy", "failed", &format!("Could not read the source file — {}", error.message));
            return Ok(with_backup(fail_value("Copy failed".to_string()), backup_name));
        }
    };
    for attempt in 1..=MAX_COPY_ATTEMPTS {
        let suffix = if MAX_COPY_ATTEMPTS > 1 { format!(" (attempt {attempt}/{MAX_COPY_ATTEMPTS})") } else { String::new() };
        record("copy", "running", &format!("Copying {file_name}…{suffix}"));
        if let Some(emitter) = emitter {
            emitter("store-update:progress", json!({ "runId": run_id, "checkoutId": checkout_id, "name": checkout_name, "percent": 0, "attempt": attempt }));
        }
        let (progress_tx, mut progress_rx) = tokio::sync::mpsc::channel::<(u64, u64)>(64);
        let progress_task = tokio::spawn({
            let emitter = emitter.clone();
            let run_id = run_id.to_string();
            let checkout_id = checkout_id.clone();
            let checkout_name = checkout_name.clone();
            async move {
                let mut last = Instant::now() - Duration::from_secs(1);
                while let Some((written, total)) = progress_rx.recv().await {
                    let percent = if total > 0 { (written * 100 / total) as i64 } else { 100 };
                    if written != total && last.elapsed() < Duration::from_millis(100) {
                        continue;
                    }
                    last = Instant::now();
                    if let Some(emitter) = &emitter {
                        emitter("store-update:progress", json!({ "runId": run_id, "checkoutId": checkout_id, "name": checkout_name, "percent": percent, "written": written, "total": total }));
                    }
                }
            }
        });
        let copy_result = crate::services::software::stream_copy(
            Path::new(source),
            Path::new(&target),
            source_size,
            {
                let progress_tx = progress_tx.clone();
                move |written, total| {
                    let _ = progress_tx.try_send((written, total));
                }
            },
            COPY_TIMEOUT_MS,
        )
        .await;
        progress_rx.close();
        let _ = progress_task.await;
        if let Err(error) = copy_result {
            record("copy", "failed", &format!("Copy failed — {}", error.message));
            return Ok(with_backup(fail_value("Copy failed".to_string()), backup_name));
        }
        record("copy", "done", &format!("{source_size} bytes copied{suffix}"));
        record("verify", "running", &format!("Comparing SHA-256 of source and destination…{suffix}"));
        let target_hash = match tokio::time::timeout(Duration::from_millis(COPY_TIMEOUT_MS), sha256_file(Path::new(&target))).await {
            Err(_) => {
                record("verify", "failed", &format!("Hashing the copy on {address} stalled"));
                return Ok(with_backup(fail_value("Verification failed".to_string()), backup_name));
            }
            Ok(Err(error)) => {
                record("verify", "failed", &format!("Could not hash the copied file — {}", error.message));
                return Ok(with_backup(fail_value("Verification failed".to_string()), backup_name));
            }
            Ok(Ok(hash)) => hash,
        };
        if target_hash == source_hash {
            record("verify", "done", "SHA-256 hashes match — the copy is intact");
            let finish_detail = if backup_name.is_some() {
                format!("Deployed {file_name} (previous file kept as {})", backup_name.clone().unwrap_or_default())
            } else {
                format!("Deployed {file_name}")
            };
            record("finish", "done", &finish_detail);
            let mut payload = json!({ "ok": true, "bytes": source_size, "attempts": attempt, "sha256": source_hash });
            if let Some(backup) = &backup_name {
                payload["backup"] = json!(backup);
            }
            return Ok(payload);
        }
        let verify_message = if attempt < MAX_COPY_ATTEMPTS {
            "SHA-256 mismatch — deleting the corrupt copy and repeating"
        } else {
            "SHA-256 still differs after the final attempt"
        };
        record("verify", "failed", verify_message);
        match tokio::fs::remove_file(&target).await {
            Ok(_) => {}
            Err(error) => {
                record("verify", "failed", &format!("Could not delete the corrupt copy — {error}"));
                return Ok(with_backup(fail_value("Corrupt copy could not be removed".to_string()), backup_name));
            }
        }
    }
    let mut payload = fail_value(format!("SHA-256 mismatch after {MAX_COPY_ATTEMPTS} attempts"));
    if let Some(backup) = backup_name {
        payload["backup"] = json!(backup);
    }
    Ok(payload)
}

fn fail_value(error: String) -> Value {
    json!({ "ok": false, "error": error })
}

fn with_backup(mut payload: Value, backup: Option<String>) -> Value {
    if let Some(backup) = backup {
        payload["backup"] = json!(backup);
    }
    payload
}
