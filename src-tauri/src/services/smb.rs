//! Port of electron/services/smb.service.js — cross-domain checkout access via
//! `net use \\host\IPC$`, reference-counted so parallel sweeps share a session.

use crate::error::{AppError, AppResult};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Arc;

const HOST_PATTERN: &str = "^[a-zA-Z0-9._-]{1,253}$";

pub struct RunOutcome {
    pub ok: bool,
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

pub fn run_command(command: &str, args: &[String], timeout_ms: u64) -> RunOutcome {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new(command);
        cmd.args(args).creation_flags(0x08000000);
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = Command::new(command);
        cmd.args(args);
        cmd
    };
    cmd.stdin(std::process::Stdio::null());
    let child = cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn();
    let Ok(mut child) = child else {
        return RunOutcome { ok: false, code: -1, stdout: String::new(), stderr: format!("{command} could not be started"), timed_out: false };
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = child.stdout.take().map(|mut out| {
                    use std::io::Read;
                    let mut text = String::new();
                    let _ = out.read_to_string(&mut text);
                    text
                });
                let stderr = child.stderr.take().map(|mut out| {
                    use std::io::Read;
                    let mut text = String::new();
                    let _ = out.read_to_string(&mut text);
                    text
                });
                return RunOutcome {
                    ok: status.success(),
                    code: status.code().unwrap_or(0),
                    stdout: stdout.unwrap_or_default(),
                    stderr: stderr.unwrap_or_default(),
                    timed_out: false,
                };
            }
            Ok(None) => {
                if std::time::Instant::now() > deadline {
                    let _ = child.kill();
                    return RunOutcome { ok: false, code: -1, stdout: String::new(), stderr: String::new(), timed_out: true };
                }
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            Err(error) => {
                return RunOutcome { ok: false, code: -1, stdout: String::new(), stderr: error.to_string(), timed_out: false };
            }
        }
    }
}

/// `okcs` + `administrator` → `okcs\administrator`; a domain already typed into the username wins.
pub fn qualify_user(domain: &str, username: &str) -> String {
    let user = username.trim();
    if user.is_empty() {
        return String::new();
    }
    if user.contains('\\') || user.contains('@') {
        return user.to_string();
    }
    let dom = domain.trim().trim_end_matches('\\');
    if dom.is_empty() {
        user.to_string()
    } else {
        format!("{dom}\\{user}")
    }
}

pub fn normalize_host(host: &str) -> AppResult<String> {
    static PATTERN: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(HOST_PATTERN).expect("static pattern"));
    let clean = host.trim().trim_start_matches('\\').to_string();
    let clean = clean.split(['\\', '/']).next().unwrap_or("").to_string();
    if clean.is_empty() || !PATTERN.is_match(&clean) {
        return Err(AppError::new(format!("Invalid host name \u{201c}{host}\u{201d}")));
    }
    Ok(clean)
}

struct SessionEntry {
    count: usize,
    ready: Option<Result<(), AppError>>,
}

pub struct SmbSessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
}

impl SmbSessionManager {
    pub fn new() -> Self {
        Self { sessions: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Credentials as stored in Settings → Store App → Target access.
    pub fn credentials_from(settings: &Value) -> Value {
        json!({
            "domain": settings.get("target_domain").and_then(Value::as_str).unwrap_or("").trim(),
            "username": settings.get("target_admin_user").and_then(Value::as_str).unwrap_or("").trim(),
            "password": settings.get("target_admin_password").and_then(Value::as_str).unwrap_or("")
        })
    }

    async fn connect(&self, host: &str, credentials: &Value) -> Result<(), AppError> {
        let domain = credentials.get("domain").and_then(Value::as_str).unwrap_or("");
        let username = credentials.get("username").and_then(Value::as_str).unwrap_or("");
        let password = credentials.get("password").and_then(Value::as_str).unwrap_or("");
        let user = qualify_user(domain, username);
        let ipc = format!(r"\\{host}\IPC$");
        // Drop whatever session Windows may already hold for this server —
        // otherwise `net use` fails with 1219 (multiple connections not allowed).
        let _ = tokio::task::spawn_blocking({
            let ipc = ipc.clone();
            move || run_command("net", &["use".into(), ipc, "/delete".into(), "/y".into()], 15000)
        })
        .await;
        let user_arg = format!("/user:{user}");
        let result = tokio::task::spawn_blocking({
            let ipc = ipc.clone();
            let password = password.to_string();
            move || {
                run_command(
                    "net",
                    &["use".into(), ipc, password, user_arg, "/persistent:no".into()],
                    25000,
                )
            }
        })
        .await
        .map_err(|error| AppError::new(error.to_string()))?;
        if !result.ok {
            let message = if result.stderr.is_empty() { &result.stdout } else { &result.stderr };
            let message = regex::Regex::new(r"\s+").map(|pattern| pattern.replace_all(message, " ").trim().to_string()).unwrap_or_else(|_| message.trim().to_string());
            if result.timed_out {
                return Err(AppError::new(format!("Timed out opening an SMB session to {host}")));
            }
            let lower = message.to_lowercase();
            if message.contains("1326") || lower.contains("logon failure") || lower.contains("user name or password") {
                return Err(AppError::new(format!(
                    "{host} rejected the credentials for {user} — check Settings → Store App → Target access"
                )));
            }
            if message.contains("1219") {
                return Err(AppError::new(format!(
                    "{host} already has a session with different credentials; sign out of it and retry"
                )));
            }
            let detail = if message.is_empty() { "net use failed".to_string() } else { message };
            return Err(AppError::new(format!("Could not open an SMB session to {host} — {detail}")));
        }
        Ok(())
    }

    /// Runs `task` with an authenticated session to `host` held open, then
    /// releases it. Concurrent callers for the same host share one session.
    /// With no credentials configured the task simply runs on the caller's own
    /// identity, which is what a same-domain deployment needs.
    pub async fn with_host<T, F>(&self, host: &str, credentials: &Value, task: F) -> Result<T, AppError>
    where
        // The task is awaited inline on the caller's context (never spawned),
        // so it does not need to be Send — agent import drives it with a
        // non-Send progress closure, matching electron's withHost wrapper.
        F: std::future::Future<Output = Result<T, AppError>>,
    {
        let clean = normalize_host(host)?;
        let username = credentials.get("username").and_then(Value::as_str).unwrap_or("");
        let password = credentials.get("password").and_then(Value::as_str).unwrap_or("");
        let usable = cfg!(windows) && !username.is_empty() && !password.is_empty();
        if !usable {
            return task.await;
        }
        let key = clean.to_lowercase();
        // Register this caller and create the session promise if absent.
        let waiter = {
            let sessions = self.sessions.clone();
            let key = key.clone();
            let clean = clean.clone();
            let credentials = credentials.clone();
            async move {
                let already = {
                    let mut guard = sessions.lock();
                    if let Some(entry) = guard.get_mut(&key) {
                        entry.count += 1;
                        true
                    } else {
                        guard.insert(key.clone(), SessionEntry { count: 1, ready: None });
                        false
                    }
                };
                if already {
                    return;
                }
                let manager = SmbSessionManager { sessions: sessions.clone() };
                let outcome = manager.connect(&clean, &credentials).await;
                let mut guard = sessions.lock();
                if let Some(entry) = guard.get_mut(&key) {
                    entry.ready = Some(outcome);
                }
            }
        };
        waiter.await;
        // Wait until the session promise resolves.
        loop {
            let snapshot = {
                let guard = self.sessions.lock();
                guard.get(&key).map(|entry| (entry.count, entry.ready.clone()))
            };
            match snapshot {
                Some((_, Some(result))) => match result {
                    Ok(()) => {
                        // Hold the session for the duration of the task, then release.
                        let outcome = task.await;
                        self.release(&key, &clean).await;
                        return outcome;
                    }
                    // A failed sign-in must not stay cached: clear the entry so
                    // the next caller gets a fresh attempt instead of a stuck error.
                    Err(error) => {
                        self.sessions.lock().remove(&key);
                        return Err(error);
                    }
                },
                Some(_) => tokio::time::sleep(std::time::Duration::from_millis(50)).await,
                None => return Err(AppError::new(format!("SMB session to {clean} was released early"))),
            }
        }
    }

    async fn release(&self, key: &str, host: &str) {
        let should_delete = {
            let mut guard = self.sessions.lock();
            let remove = guard.get(key).map(|entry| entry.count <= 1).unwrap_or(false);
            if remove {
                guard.remove(key);
            } else if let Some(entry) = guard.get_mut(key) {
                entry.count -= 1;
            }
            remove
        };
        if should_delete {
            let ipc = format!(r"\\{host}\IPC$");
            let _ = tokio::task::spawn_blocking(move || run_command("net", &["use".into(), ipc, "/delete".into(), "/y".into()], 15000)).await;
        }
    }

    /// Verifies the stored credentials against one host, for the Settings "Test" button.
    pub async fn test(&self, host: &str, credentials: &Value) -> AppResult<Value> {
        let clean = normalize_host(host)?;
        if !cfg!(windows) {
            return Err(AppError::new("Target access can only be tested on Windows"));
        }
        let username = credentials.get("username").and_then(Value::as_str).unwrap_or("");
        let password = credentials.get("password").and_then(Value::as_str).unwrap_or("");
        if username.is_empty() || password.is_empty() {
            return Err(AppError::new("Enter a username and password first"));
        }
        let started = std::time::Instant::now();
        self.connect(&clean, credentials).await?;
        let dir_target = format!(r"\\{}\C$", clean);
        let probe = tokio::task::spawn_blocking(move || {
            run_command("cmd", &["/c".into(), "dir".into(), dir_target], 20000)
        })
        .await
        .map_err(|error| AppError::new(error.to_string()))?;
        let ipc = format!(r"\\{}\IPC$", clean);
        let _ = tokio::task::spawn_blocking(move || run_command("net", &["use".into(), ipc, "/delete".into(), "/y".into()], 15000)).await;
        if !probe.ok {
            return Err(AppError::new(format!(
                "Signed in to {clean} but the C$ admin share is not reachable — is the account a local administrator there?"
            )));
        }
        Ok(json!({
            "ok": true, "host": clean,
            "user": qualify_user(credentials.get("domain").and_then(Value::as_str).unwrap_or(""), username),
            "durationMs": started.elapsed().as_millis() as u64
        }))
    }

    /// Releases every session this process opened (called on app quit).
    pub async fn release_all(&self) {
        let hosts: Vec<String> = self.sessions.lock().keys().cloned().collect();
        self.sessions.lock().clear();
        for host in hosts {
            let ipc = format!(r"\\{host}\IPC$");
            let _ = tokio::task::spawn_blocking(move || run_command("net", &["use".into(), ipc, "/delete".into(), "/y".into()], 10000)).await;
        }
    }
}

impl Default for SmbSessionManager {
    fn default() -> Self {
        Self::new()
    }
}
