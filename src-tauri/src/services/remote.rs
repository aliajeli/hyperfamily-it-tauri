//! Port of electron/services/remote.service.js — RDP (cmdkey+mstsc),
//! TeamViewer (LAN mode by IP), Winbox with stored credentials, and browser
//! opens. The in-app webview mode lives in device_webview.rs.

use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

const TEAMVIEWER_CANDIDATES: [&str; 2] = [
    r"C:\Program Files\TeamViewer\TeamViewer.exe",
    r"C:\Program Files (x86)\TeamViewer\TeamViewer.exe",
];
const WINBOX_CANDIDATES: [&str; 3] = [
    r"C:\Program Files\Mikrotik\Winbox\winbox64.exe",
    r"C:\Program Files\Winbox\winbox64.exe",
    r"C:\Program Files (x86)\Winbox\winbox.exe",
];

pub fn resolve_executable(configured: Option<&str>, candidates: &[&str]) -> Option<String> {
    let mut list: Vec<String> = Vec::new();
    if let Some(path) = configured {
        if !path.trim().is_empty() {
            list.push(path.to_string());
        }
    }
    for candidate in candidates {
        list.push(candidate.to_string());
    }
    list.into_iter().find(|item| std::fs::metadata(item).is_ok())
}

fn detached(executable: &str, args: &[String]) -> AppResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let child = std::process::Command::new(executable)
            .args(args)
            .creation_flags(0x00000008 | 0x08000000) // DETACHED_PROCESS | CREATE_NO_WINDOW
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        match child {
            Ok(child) => {
                std::mem::forget(child);
                Ok(())
            }
            Err(error) => Err(AppError::new(format!("{executable} could not be started: {error}"))),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (executable, args);
        Err(AppError::new("This connection method can only launch on Windows"))
    }
}

pub struct RemoteService {
    database: std::sync::Arc<crate::db::AppDatabase>,
}

impl RemoteService {
    pub fn new(database: std::sync::Arc<crate::db::AppDatabase>) -> Self {
        Self { database }
    }

    async fn resolve_credential(&self, device_id: i64, credential_id: Option<i64>) -> AppResult<Option<Value>> {
        match credential_id.filter(|id| *id != 0) {
            Some(id) => self.database.get_credential(id),
            None => self.database.resolve_device_credential(device_id),
        }
    }

    /// Launches one connection method. The `webview` method returns the
    /// session descriptor for device_webview.rs instead of launching anything.
    pub async fn connect(&self, payload: &Value, actor: &str) -> AppResult<Value> {
        let method = payload.get("method").and_then(Value::as_str).unwrap_or("");
        let device_id = payload.get("deviceId").and_then(Value::as_f64).map(|value| value as i64).unwrap_or(0);
        let credential_id = payload
            .get("credentialId")
            .and_then(Value::as_f64)
            .map(|value| value as i64)
            .or_else(|| payload.get("credentialId").and_then(Value::as_i64));
        let device = self.database.get_device(device_id)?.ok_or_else(|| AppError::new("Device not found"))?;
        let ip = device.get("ip").and_then(Value::as_str).unwrap_or("");
        let pattern = regex::Regex::new(r"^[a-zA-Z0-9.-]{1,253}$").expect("static regex");
        if !pattern.is_match(ip) {
            return Err(AppError::new("Unsafe or invalid device address"));
        }
        let credential = self.resolve_credential(device_id, credential_id).await?;
        let target = format!(
            "{} ({ip})",
            device.get("name").and_then(Value::as_str).filter(|text| !text.is_empty()).unwrap_or_else(|| device.get("device_type").and_then(Value::as_str).unwrap_or(""))
        );

        let result: AppResult<Value> = async {
            match method {
                "rdp" => self.rdp(&device, credential.as_ref()).await,
                "teamviewer" => self.teamviewer(&device),
                "winbox" => self.winbox(&device, credential.as_ref()),
                "browser" => self.browser(&device, credential.as_ref()).await,
                "webview" => self.webview_session(&device, credential.as_ref()),
                other => Err(AppError::new(format!("Unsupported remote connection method: {other}"))),
            }
        }
        .await;
        match &result {
            Ok(_value) => {
                let detail = credential
                    .as_ref()
                    .map(|credential| format!("Credential: {}", credential.get("name").and_then(Value::as_str).unwrap_or("")))
                    .unwrap_or_else(|| "No mapped credential".into());
                self.database.audit(actor, &format!("{}_CONNECT", method.to_uppercase()), &target, &detail);
            }
            Err(error) => {
                self.database.audit(actor, &format!("{}_ERROR", method.to_uppercase()), &target, &error.message);
            }
        }
        result
    }

    async fn rdp(&self, device: &Value, credential: Option<&Value>) -> AppResult<Value> {
        crate::services::software::require_windows("Remote Desktop")?;
        let Some(credential) = credential else {
            return Err(AppError::new("Assign a credential to this device in Settings → Credentials first"));
        };
        let ip = device.get("ip").and_then(Value::as_str).unwrap_or("");
        let username = credential.get("username").and_then(Value::as_str).unwrap_or("");
        let password = credential.get("password").and_then(Value::as_str).unwrap_or("");
        let store = format!("/generic:TERMSRV/{ip}");
        let user_arg = format!("/user:{username}");
        let pass_arg = format!("/pass:{password}");
        let stored = tokio::process::Command::new("cmdkey.exe")
            .args([store.as_str(), user_arg.as_str(), pass_arg.as_str()])
            .output()
            .await
            .map_err(|_| AppError::new("Windows Credential Manager rejected the RDP credential"))?;
        if !stored.status.success() {
            return Err(AppError::new("Windows Credential Manager rejected the RDP credential"));
        }
        let port = device.get("port").and_then(Value::as_i64).unwrap_or(0);
        let target = if port > 0 { format!("/v:{ip}:{port}") } else { format!("/v:{ip}") };
        detached("mstsc.exe", &[target])?;
        Ok(json!({ "success": true }))
    }

    fn teamviewer(&self, device: &Value) -> AppResult<Value> {
        crate::services::software::require_windows("TeamViewer")?;
        let settings = self.database.get_settings().unwrap_or(json!({}));
        let executable = resolve_executable(settings.get("teamviewer_path").and_then(Value::as_str), &TEAMVIEWER_CANDIDATES)
            .ok_or_else(|| AppError::new("TeamViewer executable was not found; set its path in Settings → Device Tools"))?;
        let lan_mode = settings.get("teamviewer_lan_mode").and_then(Value::as_bool).unwrap_or(true);
        let identifier = if lan_mode {
            device.get("ip").and_then(Value::as_str).unwrap_or("").to_string()
        } else {
            device
                .get("remote_id")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .or_else(|| device.get("terminal_id").and_then(Value::as_str))
                .unwrap_or("")
                .to_string()
        };
        if identifier.is_empty() {
            return Err(AppError::new("This device has no TeamViewer ID. Enable LAN connections to connect by IP instead."));
        }
        let mut args = vec!["-i".to_string(), identifier];
        if let Some(password) = settings.get("teamviewer_password").and_then(Value::as_str).filter(|text| !text.is_empty()) {
            args.push("-p".to_string());
            args.push(password.to_string());
        }
        detached(&executable, &args)?;
        Ok(json!({ "success": true }))
    }

    fn winbox(&self, device: &Value, credential: Option<&Value>) -> AppResult<Value> {
        crate::services::software::require_windows("Winbox")?;
        let settings = self.database.get_settings().unwrap_or(json!({}));
        let executable = resolve_executable(settings.get("winbox_path").and_then(Value::as_str), &WINBOX_CANDIDATES)
            .ok_or_else(|| AppError::new("Winbox executable was not found; set its path in Settings → Device Tools"))?;
        let ip = device.get("ip").and_then(Value::as_str).unwrap_or("");
        let port = device
            .get("port")
            .and_then(Value::as_i64)
            .filter(|port| *port > 0)
            .or_else(|| settings.get("winbox_port").and_then(Value::as_i64))
            .unwrap_or(8291);
        let endpoint = format!("{ip}:{port}");
        let Some(credential) = credential else {
            return Err(AppError::new("Assign a credential to this router in Settings → Credentials so Winbox can log in automatically"));
        };
        let username = credential.get("username").and_then(Value::as_str).unwrap_or("").to_string();
        let password = credential.get("password").and_then(Value::as_str).unwrap_or("").to_string();
        detached(&executable, &[endpoint, username, password])?;
        Ok(json!({ "success": true }))
    }

    async fn browser(&self, device: &Value, credential: Option<&Value>) -> AppResult<Value> {
        let protocol = if device.get("protocol").and_then(Value::as_str) == Some("http") { "http" } else { "https" };
        let ip = device.get("ip").and_then(Value::as_str).unwrap_or("");
        let port = device.get("port").and_then(Value::as_i64).unwrap_or(0);
        let authority = match credential {
            Some(credential) => {
                let username = credential.get("username").and_then(Value::as_str).unwrap_or("");
                let password = credential.get("password").and_then(Value::as_str).unwrap_or("");
                format!("{}:{}@{ip}", urlencode(username), urlencode(password))
            }
            None => ip.to_string(),
        };
        let url = if port > 0 { format!("{protocol}://{authority}:{port}") } else { format!("{protocol}://{authority}") };
        open_in_browser(&url)?;
        Ok(json!({ "success": true }))
    }

    /// Descriptor for the embedded device window used by iLO and NVR devices.
    /// The credential travels to the Rust layer only, which injects it into
    /// the guest page; it is never exposed to the requesting renderer.
    fn webview_session(&self, device: &Value, credential: Option<&Value>) -> AppResult<Value> {
        let Some(credential) = credential else {
            return Err(AppError::new("Assign a credential to this device in Settings \u{2192} Credentials so it can sign in automatically"));
        };
        let protocol = if device.get("protocol").and_then(Value::as_str) == Some("http") { "http" } else { "https" };
        let ip = device.get("ip").and_then(Value::as_str).unwrap_or("");
        let port = device.get("port").and_then(Value::as_i64).unwrap_or(0);
        let device_id = device.get("id").and_then(Value::as_i64).unwrap_or(0);
        let title = format!(
            "{} \u{00b7} {ip}",
            device.get("name").and_then(Value::as_str).filter(|text| !text.is_empty()).unwrap_or_else(|| device.get("device_type").and_then(Value::as_str).unwrap_or(""))
        );
        let kind = if device.get("device_type").and_then(Value::as_str) == Some("NVR") { "nvr" } else { "ilo" };
        Ok(json!({
            "deviceId": device_id,
            "title": title,
            "kind": kind,
            "url": if port > 0 { format!("{protocol}://{ip}:{port}/") } else { format!("{protocol}://{ip}/") },
            "username": credential.get("username").cloned().unwrap_or(json!("")),
            "password": credential.get("password").cloned().unwrap_or(json!(""))
        }))
    }

    pub fn probe(&self) -> Value {
        let settings = self.database.get_settings().unwrap_or(json!({}));
        json!({
            "teamviewer": resolve_executable(settings.get("teamviewer_path").and_then(Value::as_str), &TEAMVIEWER_CANDIDATES),
            "winbox": resolve_executable(settings.get("winbox_path").and_then(Value::as_str), &WINBOX_CANDIDATES)
        })
    }
}

fn urlencode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Opens an http(s) URL in the default browser (the Electron `shell.openExternal`
/// equivalent, minus the capability to open arbitrary schemes).
fn open_in_browser(url: &str) -> AppResult<()> {
    if !url.to_lowercase().starts_with("http://") && !url.to_lowercase().starts_with("https://") {
        return Err(AppError::new("Only http and https addresses can be opened"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler".to_string(), url.to_string()])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| AppError::new(format!("The link could not be opened: {error}")))?;
    }
    #[cfg(not(windows))]
    {
        let _ = url;
    }
    Ok(())
}
