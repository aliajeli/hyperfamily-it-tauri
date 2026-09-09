//! Port of electron/services/vpn.service.js — one VPN mode: "global", driving
//! the installed FortiClient. The tunnel indicator is honest: it only turns
//! green while a Fortinet virtual adapter actually holds a routable address.

use crate::error::{AppError, AppResult};
use crate::services::Emitter;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

pub const FORTICLIENT_DOWNLOAD: &str = "https://www.fortinet.com/support/product-downloads#vpn";
const FORTICLIENT_CANDIDATES: [&str; 4] = [
    r"C:\Program Files\Fortinet\FortiClient\FortiClient.exe",
    r"C:\Program Files\Fortinet\FortiClient\FortiSSLVPNclient.exe",
    r"C:\Program Files (x86)\Fortinet\FortiClient\FortiClient.exe",
    r"C:\Program Files (x86)\Fortinet\FortiClient\FortiSSLVPNclient.exe",
];
const DISCONNECT_COMMANDS: [(&str, [&str; 1]); 3] = [
    ("FortiVPN.exe", ["--cli"]),
    ("FortiClient.exe", ["disconnect"]),
    ("FortiSSLVPNclient.exe", ["disconnect"]),
];
const GLOBAL_TUNNEL_TIMEOUT_MS: u64 = 90_000;
const DISCONNECT_TUNNEL_TIMEOUT_MS: u64 = 12_000;
const VPN_SERVICES: [&str; 4] = ["FortiSSLVPNdaemon", "FA_Scheduler", "FortiClient", "FortiClientService"];

fn find_forticlient(configured_path: Option<&str>) -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Some(path) = configured_path {
        if !path.trim().is_empty() {
            candidates.push(path.to_string());
        }
    }
    for candidate in FORTICLIENT_CANDIDATES {
        candidates.push(candidate.to_string());
    }
    candidates.into_iter().find(|candidate| std::fs::metadata(candidate).is_ok())
}

/// Detects every usable non-internal IPv4 address via PowerShell — the same
/// signal set as the Electron build: adapter NAME, hardware DESCRIPTION, and
/// a connect-time baseline of new interfaces.
pub async fn ipv4_addresses() -> Vec<(String, String)> {
    let script = r#"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -ne '0.0.0.0' } |
  ForEach-Object {
    $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
    if ($adapter) { "$($adapter.Name)|$($_.IPAddress)|$($adapter.InterfaceDescription)" }
  }
"#
    .trim();
    let output = crate::services::software::run_ps(script, 8000).await.unwrap_or_default();
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.trim().split('|');
            let name = parts.next()?.trim().to_string();
            let address = parts.next()?.trim().to_string();
            let description = parts.next().unwrap_or("").trim().to_string();
            if address.is_empty() || address.starts_with("169.254.") {
                return None;
            }
            Some((format!("{name}\t{description}"), address))
        })
        .collect()
}

async fn query_service_running(name: &str) -> bool {
    let mut command = tokio::process::Command::new("sc");
    command.args(["query", name]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = tokio::time::timeout(Duration::from_millis(4000), command.output()).await;
    match output {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let running = regex::Regex::new(r"(?i)STATE\s+:\s*4\s+RUNNING").map(|pattern| pattern.is_match(&stdout)).unwrap_or(false);
            if stdout.trim().is_empty() && output.status.code() != Some(0) {
                false
            } else {
                running
            }
        }
        _ => false,
    }
}

async fn is_vpn_service_running() -> bool {
    if !cfg!(windows) {
        return false;
    }
    for name in VPN_SERVICES {
        if query_service_running(name).await {
            return true;
        }
    }
    false
}

async fn is_forticlient_process_running() -> bool {
    if !cfg!(windows) {
        return false;
    }
    let mut command = tokio::process::Command::new("tasklist");
    command.args(["/fo", "csv", "/nh"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = tokio::time::timeout(Duration::from_millis(6000), command.output()).await;
    match output {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            ["fortisslvpndaemon.exe", "forticlient.exe", "fortitray.exe", "fortisslvpnclient.exe"]
                .iter()
                .any(|name| stdout.contains(&format!("\"{name}\"")) || stdout.contains(name))
        }
        _ => false,
    }
}

fn tunnel_name_matches(name: &str) -> bool {
    let pattern = regex::Regex::new(r"(?i)forti|ppp|ssl.?vpn|tap.?windows|vpn").expect("static regex");
    pattern.is_match(name)
}

fn description_matches(description: &str) -> bool {
    let pattern = regex::Regex::new(r"(?i)forti|ssl.?vpn|pangp|tap-windows").expect("static regex");
    pattern.is_match(description)
}

pub async fn detect_global_tunnel(baseline: Option<&Vec<(String, String)>>) -> (bool, bool, bool) {
    if !cfg!(windows) {
        return (false, false, false);
    }
    let interfaces = ipv4_addresses().await;
    let by_name_or_description = interfaces
        .iter()
        .any(|(name, _)| {
            let mut parts = name.splitn(2, '\t');
            let adapter_name = parts.next().unwrap_or("");
            let description = parts.next().unwrap_or("");
            tunnel_name_matches(adapter_name) || description_matches(description)
        });
    let by_baseline = match baseline {
        Some(baseline) => interfaces.iter().any(|entry| !baseline.contains(entry)),
        None => false,
    };
    let adapter_up = by_name_or_description || by_baseline;
    let service = tokio::join!(is_vpn_service_running(), is_forticlient_process_running());
    let service_running = service.0 || service.1;
    (service_running, adapter_up, adapter_up)
}

pub struct VpnState {
    pub state: String,
    pub mode: Option<String>,
    pub message: String,
    pub gateway: Option<String>,
    pub live: bool,
    pub service_running: bool,
    pub tunnel_up: bool,
    pub forticlient_running: bool,
    pub baseline: Option<Vec<(String, String)>>,
}

pub struct VpnService {
    pub database: Arc<crate::db::AppDatabase>,
    pub emitter: Emitter,
    pub state: parking_lot::Mutex<VpnState>,
}

impl VpnService {
    pub fn new(database: Arc<crate::db::AppDatabase>, emitter: Emitter) -> Self {
        Self {
            database,
            emitter,
            state: parking_lot::Mutex::new(VpnState {
                state: "disconnected".into(),
                mode: None,
                message: String::new(),
                gateway: None,
                live: false,
                service_running: false,
                tunnel_up: false,
                forticlient_running: false,
                baseline: None,
            }),
        }
    }

    pub fn status_value(&self, message: Option<&str>) -> Value {
        let state = self.state.lock();
        let settings = self.database.get_settings().unwrap_or(json!({}));
        let installed = find_forticlient(settings.get("forticlient_path").and_then(Value::as_str)).is_some();
        json!({
            "state": state.state,
            "mode": state.mode,
            "message": message.unwrap_or(state.message.as_str()),
            "gateway": state.gateway,
            "stats": { "requests": 0, "bytes": 0, "since": Value::Null },
            "live": state.live,
            "serviceRunning": state.service_running,
            "tunnelUp": state.tunnel_up,
            "forticlientInstalled": installed
        })
    }

    fn emit_status(&self, state_name: &str, mode: Option<&str>, message: &str) {
        {
            let mut state = self.state.lock();
            state.state = state_name.to_string();
            state.mode = mode.map(String::from);
            state.message = message.to_string();
        }
        let payload = self.status_value(Some(message));
        (self.emitter)("vpn:status", payload);
    }

    /// Availability probe used by the UI before offering the global mode.
    pub fn probe(&self) -> Value {
        let settings = self.database.get_settings().unwrap_or(json!({}));
        let executable = find_forticlient(settings.get("forticlient_path").and_then(Value::as_str));
        json!({
            "installed": executable.is_some(),
            "path": executable,
            "downloadUrl": FORTICLIENT_DOWNLOAD,
            "configured": executable.is_some()
        })
    }

    pub async fn connect(&self, mode: &str, actor: &str) -> AppResult<Value> {
        let requested = if mode == "split" { "in_app" } else if mode == "full" { "global" } else { mode };
        if !["in_app", "global", ""].contains(&requested) {
            return Err(AppError::new("Invalid VPN mode"));
        }
        {
            let state = self.state.lock();
            if state.state == "connecting" || state.state.starts_with("connected") {
                return Err(AppError::new("A VPN session is already active"));
            }
        }
        let settings = self.database.get_settings()?;
        let executable = find_forticlient(settings.get("forticlient_path").and_then(Value::as_str));
        self.emit_status("connecting", Some("global"), "");
        if let Some(executable) = executable {
            // Launch the installed client so the user completes the sign-in
            // there. The child is intentionally left running: FortiClient
            // manages its own lifetime (the Electron build used detached+unref).
            let _ = std::process::Command::new(&executable)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map(|child| std::mem::forget(child));
        } else {
            self.emit_status("error", None, "FortiClient VPN is not installed on this computer. Install the FortiClient VPN client, then try the Global mode again.");
            return Err(AppError::with_payload(
                "FortiClient VPN is not installed on this computer. Install the FortiClient VPN client, then try the Global mode again.",
                json!({ "code": "FORTICLIENT_MISSING", "downloadUrl": FORTICLIENT_DOWNLOAD }),
            ));
        }

        // Record which addresses existed before FortiClient starts, so a
        // renamed tunnel adapter is still recognised as new.
        let baseline = ipv4_addresses().await;
        self.state.lock().baseline = Some(baseline.clone());
        let already = detect_global_tunnel(None).await;
        if already.2 {
            let mut state = self.state.lock();
            state.tunnel_up = true;
            state.service_running = true;
            state.forticlient_running = true;
            state.live = true;
            state.baseline = None;
            drop(state);
            self.database.audit(actor, "VPN_CONNECT", "global", "Adopted an already-connected FortiClient tunnel");
            self.emit_status("connected_global", Some("global"), "");
            return Ok(self.status_value(None));
        }
        // Advisory wait: signing in happens inside FortiClient and can outlast
        // any timeout we pick, so an elapsed wait stays a watching state.
        let deadline = std::time::Instant::now() + Duration::from_millis(GLOBAL_TUNNEL_TIMEOUT_MS);
        while std::time::Instant::now() < deadline {
            let probe = detect_global_tunnel(Some(&baseline)).await;
            if probe.2 {
                let mut state = self.state.lock();
                state.tunnel_up = true;
                state.service_running = true;
                state.forticlient_running = true;
                state.live = true;
                state.baseline = None;
                drop(state);
                let gateway = settings
                    .get("vpn_gateway")
                    .and_then(Value::as_str)
                    .map(|gateway| gateway.trim().trim_start_matches("http://").trim_start_matches("https://").split('/').next().unwrap_or("").to_string())
                    .filter(|gateway| !gateway.is_empty());
                let port = settings.get("vpn_port").and_then(Value::as_i64).unwrap_or(443);
                self.state.lock().gateway = gateway.map(|gateway| format!("{gateway}:{port}"));
                self.database.audit(actor, "VPN_CONNECT", "global", &format!("Gateway {}", self.state.lock().gateway.clone().unwrap_or_default()));
                self.emit_status("connected_global", Some("global"), "");
                return Ok(self.status_value(None));
            }
            tokio::time::sleep(Duration::from_millis(1000)).await;
        }
        self.emit_status(
            "awaiting_forticlient",
            Some("global"),
            "FortiClient is open — finish signing in there. The indicator turns green on its own as soon as the tunnel is up.",
        );
        Ok(self.status_value(None))
    }

    /// Polls the real state once a second and emits a status update whenever
    /// it changes — the indicator also turns red when a tunnel drops on its own.
    pub async fn health_tick(&self) {
        if self.state.lock().state == "connecting" {
            return;
        }
        let baseline = self.state.lock().baseline.clone();
        let (service_running, _adapter, live) = detect_global_tunnel(baseline.as_ref()).await;
        {
            let mut state = self.state.lock();
            state.service_running = service_running;
            state.forticlient_running = service_running;
            state.tunnel_up = live;
            state.live = live;
        }
        let current_state = self.state.lock().state.clone();
        let claims_connected = current_state.starts_with("connected");
        if claims_connected && !live {
            self.emit_status("disconnected", None, "The FortiClient tunnel is no longer connected");
            return;
        }
        if !claims_connected && live {
            let was_awaiting = current_state == "awaiting_forticlient";
            if was_awaiting {
                self.database.audit("Admin", "VPN_CONNECT", "global", &format!("Gateway {}", self.state.lock().gateway.clone().unwrap_or_default()));
            }
            self.emit_status(
                "connected_global",
                Some("global"),
                if was_awaiting { "FortiClient signed in — the tunnel is up" } else { "FortiClient tunnel detected" },
            );
            return;
        }
        if self.state.lock().message.is_empty() {
            // Emit quietly only when something observable changed; the About
            // card reads these fields directly through vpn:status calls.
        }
    }

    pub async fn disconnect(&self, actor: &str) -> AppResult<Value> {
        let mode_before = self.state.lock().mode.clone().unwrap_or_else(|| "unknown".into());
        if cfg!(windows) {
            let settings = self.database.get_settings().unwrap_or(json!({}));
            let installed = find_forticlient(settings.get("forticlient_path").and_then(Value::as_str));
            let mut roots: Vec<String> = Vec::new();
            if let Some(path) = &installed {
                if let Some(parent) = PathBuf::from(path).parent() {
                    roots.push(parent.to_string_lossy().to_string());
                }
            }
            for candidate in FORTICLIENT_CANDIDATES {
                if let Some(parent) = PathBuf::from(candidate).parent() {
                    let root = parent.to_string_lossy().to_string();
                    if !roots.contains(&root) {
                        roots.push(root);
                    }
                }
            }
            for (exe, args) in DISCONNECT_COMMANDS {
                let Some(root) = roots.iter().find(|root| std::fs::metadata(format!("{root}\\{exe}")).is_ok()) else { continue };
                let full_path = format!("{root}\\{exe}");
                let args: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
                let mut command = tokio::process::Command::new(&full_path);
                command.args(&args);
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(0x08000000);
                }
                let _ = tokio::time::timeout(Duration::from_millis(15000), command.output()).await;
            }
        }
        // Poll until the adapter actually releases its address.
        let deadline = std::time::Instant::now() + Duration::from_millis(DISCONNECT_TUNNEL_TIMEOUT_MS);
        let baseline = self.state.lock().baseline.clone();
        let mut probe = detect_global_tunnel(baseline.as_ref()).await;
        while probe.2 && std::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(500)).await;
            probe = detect_global_tunnel(baseline.as_ref()).await;
        }
        if probe.2 {
            let message = "FortiClient did not drop the tunnel. Disconnect it inside the FortiClient window, or press the button again.";
            self.database.audit(actor, "VPN_DISCONNECT", &mode_before, message);
            self.emit_status("connected_global", Some("global"), message);
            return Err(AppError::new(message));
        }
        self.database.audit(actor, "VPN_DISCONNECT", &mode_before, "VPN session disconnected");
        {
            let mut state = self.state.lock();
            state.gateway = None;
            state.forticlient_running = false;
            state.service_running = false;
            state.tunnel_up = false;
            state.live = false;
            state.baseline = None;
        }
        self.emit_status("disconnected", None, "");
        Ok(self.status_value(None))
    }

    /// Reports the untouched gateway reply so a misbehaving portal can be
    /// identified. Never throws for a rejected login.
    pub async fn diagnose(&self) -> Value {
        let settings = self.database.get_settings().unwrap_or(json!({}));
        let started = std::time::Instant::now();
        let gateway = settings.get("vpn_gateway").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let username = settings.get("vpn_user").and_then(Value::as_str).unwrap_or("").to_string();
        let password = settings.get("vpn_pass").and_then(Value::as_str).unwrap_or("").to_string();
        if gateway.is_empty() {
            return json!({ "ok": false, "stage": "profile", "outcome": "error", "reason": "Set the FortiClient Remote Gateway in Settings → VPN first", "durationMs": started.elapsed().as_millis() as u64 });
        }
        if username.is_empty() || password.is_empty() {
            return json!({ "ok": false, "stage": "profile", "outcome": "error", "reason": "Set the VPN username and password in Settings → VPN first", "durationMs": started.elapsed().as_millis() as u64 });
        }
        let port = settings.get("vpn_port").and_then(Value::as_i64).unwrap_or(443);
        let target = format!("https://{gateway}:{port}/remote/logincheck");
        match crate::services::portal::portal_request(&gateway, port as u16, &username, &password).await {
            Ok(reply) => {
                let body = reply.get("body").and_then(Value::as_str).unwrap_or("");
                let verdict = portal_verdict(&reply);
                json!({
                    "ok": matches!(verdict.0.as_str(), "accepted" | "ambiguous"),
                    "stage": "logincheck",
                    "target": target,
                    "username": username,
                    "outcome": verdict.0,
                    "reason": verdict.1,
                    "statusCode": reply.get("statusCode").cloned().unwrap_or(json!(0)),
                    "statusMessage": reply.get("statusMessage").cloned().unwrap_or(json!("")),
                    "headers": reply.get("headers").cloned().unwrap_or(json!({})),
                    "setCookie": reply.get("setCookie").cloned().unwrap_or(json!([])),
                    "cookieNames": reply.get("cookies").and_then(Value::as_array).map(|cookies| json!(cookies.iter().filter_map(|cookie| cookie.as_str().map(|item| item.split('=').next().unwrap_or(""))).collect::<Vec<_>>())).unwrap_or(json!([])),
                    "bodyLength": body.len(),
                    "bodyExcerpt": &body[..std::cmp::min(2000, body.len())],
                    "transportError": reply.get("transportError").cloned().unwrap_or(json!("")),
                    "durationMs": started.elapsed().as_millis() as u64
                })
            }
            Err(error) => json!({
                "ok": false, "stage": "transport", "target": target, "username": username,
                "outcome": "error", "reason": error, "durationMs": started.elapsed().as_millis() as u64
            }),
        }
    }
}


/// FortiGate reports the outcome in the body, not the cookie jar. The rule is
/// deliberately lenient: only an explicit rejection counts as bad credentials.
fn portal_verdict(reply: &Value) -> (String, String) {
    let text = reply.get("body").and_then(Value::as_str).unwrap_or("");
    let explicit_accept = regex::Regex::new(r"(^|[^a-z])ret=1(\D|$)").map(|pattern| pattern.is_match(text)).unwrap_or(false);
    let reject_pattern = regex::Regex::new(r"(?i)(^|[^a-z])ret=0(\D|$)|permission_denied|login_failed|invalid.{0,20}(username|password|credential)").map(|pattern| pattern.is_match(text)).unwrap_or(false);
    let two_factor_pattern = regex::Regex::new(r"(?i)(^|[^a-z])ret=2(\D|$)|redir=(%2f|/)remote(%2f|/)twofactor|tokeninfo|fortitoken").map(|pattern| pattern.is_match(text)).unwrap_or(false);
    let has_cookie = reply.get("cookie").and_then(Value::as_str).map(|cookie| !cookie.is_empty()).unwrap_or(false)
        || reply.get("cookies").and_then(Value::as_array).map(|cookies| !cookies.is_empty()).unwrap_or(false);
    if reject_pattern && !explicit_accept {
        return ("rejected".into(), "The SSL VPN portal rejected the username or password".into());
    }
    if two_factor_pattern && !explicit_accept {
        return ("two_factor".into(), "The gateway requires two-factor authentication; use the Global (FortiClient) mode".into());
    }
    if explicit_accept {
        return ("accepted".into(), "The gateway returned ret=1".into());
    }
    if has_cookie {
        return ("accepted".into(), "The gateway issued a session cookie".into());
    }
    if text.trim().is_empty() && reply.get("statusCode").and_then(Value::as_i64).unwrap_or(0) == 0 {
        return ("unreachable".into(), "The VPN gateway returned an empty response. Check that the Remote Gateway host and port point at the SSL-VPN portal.".into());
    }
    ("ambiguous".into(), "The gateway did not report a result; continuing with the connection".into())
}
