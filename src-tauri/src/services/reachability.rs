//! Port of electron/services/reachability.service.js — a TCP connect to the
//! SMB port (445) decides reachability; ICMP is cosmetic latency only.

use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;

pub const SMB_PORT: u16 = 445;

pub async fn probe_port(host: &str, port: u16, timeout_ms: u64) -> (bool, u128, Option<String>) {
    let started = Instant::now();
    let attempt = tokio::time::timeout(Duration::from_millis(timeout_ms), TcpStream::connect((host, port))).await;
    match attempt {
        Ok(Ok(_stream)) => (true, started.elapsed().as_millis(), None),
        Ok(Err(error)) => (false, started.elapsed().as_millis(), Some(error.to_string())),
        Err(_) => (false, started.elapsed().as_millis(), Some("timed out".into())),
    }
}

pub async fn check_reachable(host: &str, candidates: Option<Vec<String>>, port: u16, timeout_ms: u64) -> Value {
    let mut candidate_list: Vec<String> = candidates
        .unwrap_or_else(|| vec![host.to_string()])
        .into_iter()
        .map(|value| value.trim().trim_start_matches('\\').to_string())
        .filter(|value| !value.is_empty())
        .collect();
    candidate_list.dedup();

    let mut smb_open = false;
    let mut smb_ms = 0u128;
    let mut smb_error = "no address".to_string();
    let mut target = host.to_string();
    for candidate in &candidate_list {
        let (open, ms, error) = probe_port(candidate, port, timeout_ms).await;
        if open {
            smb_open = true;
            smb_ms = ms;
            target = candidate.clone();
            break;
        }
        let message = error.clone().unwrap_or_default();
        if smb_error == "no address" || smb_error == "ENOTFOUND" {
            smb_error = message;
        }
        let _ = error;
    }

    let icmp = crate::services::ping::ping_host(&target, std::cmp::min(1500, timeout_ms)).await;
    let icmp_status = icmp.get("status").and_then(Value::as_str).unwrap_or("offline").to_string();
    let icmp_time = icmp.get("ping_time").cloned().unwrap_or(Value::Null);

    if smb_open {
        let detail = if icmp_status == "offline" {
            format!("SMB (port {port}) answered in {smb_ms} ms; ICMP is filtered, which is normal on a firewalled domain")
        } else {
            format!("SMB (port {port}) answered in {smb_ms} ms")
        };
        return json!({
            "status": "online",
            "host": target,
            "ping_time": if !icmp_time.is_null() { icmp_time } else { json!(smb_ms as u64) },
            "smb": true,
            "icmp": icmp_status != "offline",
            "detail": detail
        });
    }

    let reachable_by_ping = icmp_status != "offline";
    let dns_failure = smb_error.contains("dns error") || smb_error.contains("failed to lookup") || smb_error.contains("name or service not known") || smb_error.contains("ENOTFOUND") || smb_error.contains("EAI_AGAIN") || smb_error.contains("No such host is known") || smb_error.to_lowercase().contains("no such host");
    let detail = if dns_failure && !reachable_by_ping {
        format!("The name \u{201c}{host}\u{201d} could not be resolved by DNS. If this checkout is in another branch or domain, record its IP address on the device so it can be reached directly.")
    } else if reachable_by_ping {
        format!("{host} answers ping but port {port} (file sharing) is closed — enable File and Printer Sharing on it")
    } else {
        format!("{host} did not answer on port {port} ({smb_error}) and did not answer a ping — it looks powered off or off the network")
    };
    json!({
        "status": "offline",
        "host": target,
        "ping_time": icmp_time,
        "smb": false,
        "icmp": reachable_by_ping,
        "dns": !dns_failure,
        "detail": detail
    })
}
