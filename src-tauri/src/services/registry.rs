//! Port of electron/services/registry.service.js — remote "Programs and
//! Features" through `reg.exe query \\HOST\HKLM\...` over the Remote Registry
//! service, plus the `reg load` fallback that copies the SOFTWARE hive over
//! the admin share.

use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

// Remote-programs helpers from electron wmi-registry.service.js; the live
// inventory path runs through store_update::list_installed_on.
#[allow(dead_code)]
pub const UNINSTALL_KEYS: [&str; 2] = [
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
];

#[allow(dead_code)]
struct RegRun {
    ok: bool,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

#[allow(dead_code)]
fn run_reg(args: &[String], timeout_ms: u64) -> RegRun {
    let outcome = crate::services::smb::run_command("reg.exe", args, timeout_ms);
    RegRun { ok: outcome.ok, stdout: outcome.stdout, stderr: outcome.stderr, timed_out: outcome.timed_out }
}

/// Parses `reg query ... /s` output into program rows.
#[allow(dead_code)]
pub fn parse_reg_query(output: &str) -> Vec<Value> {
    let mut programs: Vec<Value> = Vec::new();
    let mut current: Option<Value> = None;
    {
        let flush = |current: &mut Option<Value>, programs: &mut Vec<Value>| {
            if let Some(entry) = current.take() {
                if entry.get("name").and_then(Value::as_str).map(|name| !name.is_empty()).unwrap_or(false) {
                    programs.push(entry);
                }
            }
        };
        for raw_line in output.lines() {
            let line = raw_line.trim_end();
            if line.trim().is_empty() {
                continue;
            }
            let trimmed = line.trim();
            let is_key = trimmed.starts_with("HK") || trimmed.starts_with("HKEY_") || trimmed.starts_with("\\\\");
            if is_key {
                flush(&mut current, &mut programs);
                current = Some(json!({ "key": trimmed, "name": "", "version": "", "publisher": "", "installLocation": "" }));
                continue;
            }
            // Values are separated by runs of spaces: "    DisplayName    REG_SZ    Store Commerce"
            let Some(entry) = current.as_mut() else { continue };
            let mut segments: Vec<&str> = line.split("  ").map(str::trim).filter(|part| !part.is_empty()).collect();
            if segments.len() < 3 {
                continue;
            }
            let value_name = segments.remove(0);
            let kind = segments.remove(0);
            if !kind.starts_with("REG_") {
                continue;
            }
            let value = segments.join("  ").trim().to_string();
            match value_name.to_lowercase().as_str() {
                "displayname" => entry["name"] = json!(value),
                "displayversion" => entry["version"] = json!(value),
                "publisher" => entry["publisher"] = json!(value),
                "installlocation" => entry["installLocation"] = json!(value),
                _ => {}
            }
        }
        flush(&mut current, &mut programs);
    }
    programs.into_iter().filter(|program| !program.get("name").and_then(Value::as_str).unwrap_or("").is_empty()).collect()
}

#[allow(dead_code)]
fn fail(message: &str, code: &str) -> AppError {
    let mut error = AppError::new(message.to_string());
    error.message = format!("[{code}] {message}");
    error
}

/// Every program registered on `host` ('' or 'localhost' → this machine).
#[allow(dead_code)]
pub async fn list_remote_programs(host: &str, timeout_ms: u64) -> AppResult<Vec<Value>> {
    let clean = host.trim().trim_start_matches('\\').to_string();
    let prefix = if !clean.is_empty() && !matches!(clean.to_lowercase().as_str(), "localhost" | "127.0.0.1" | ".") {
        format!(r"\\{clean}\")
    } else {
        String::new()
    };
    let mut runs: Vec<RegRun> = Vec::new();
    for key in UNINSTALL_KEYS {
        let args = vec!["query".to_string(), format!("{prefix}HKLM\\{key}"), "/s".to_string()];
        let handle = tokio::task::spawn_blocking(move || run_reg(&args, timeout_ms));
        runs.push(handle.await.map_err(|error| AppError::new(error.to_string()))?);
    }
    let reachable = runs.iter().any(|run| run.ok);
    if !reachable {
        let detail = runs
            .iter()
            .map(|run| if run.stderr.is_empty() { run.stdout.clone() } else { run.stderr.clone() })
            .find(|text| !text.trim().is_empty())
            .unwrap_or_default();
        let detail = detail.split_whitespace().collect::<Vec<_>>().join(" ");
        if runs.iter().any(|run| run.timed_out) {
            return Err(fail(&format!("{} did not answer the registry query in time", if clean.is_empty() { "This machine" } else { &clean }), "REGISTRY_TIMEOUT"));
        }
        if detail.to_lowercase().contains("access is denied") {
            return Err(fail(&format!("Access denied reading the registry on {clean} — check Settings → Store App → Target access"), "REGISTRY_DENIED"));
        }
        let lower = detail.to_lowercase();
        if lower.contains("unable to find") || lower.contains("network path") || lower.contains("rpc server") || lower.contains("cannot find the file") {
            return Err(fail(&format!("The Remote Registry service is not answering on {clean}"), "REGISTRY_UNAVAILABLE"));
        }
        return Err(fail(
            &format!("Registry query failed on {}{}", if clean.is_empty() { "this machine" } else { &clean }, if detail.is_empty() { String::new() } else { format!(" — {detail}") }),
            "REGISTRY_FAILED",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    let mut programs: Vec<Value> = Vec::new();
    for run in &runs {
        for program in parse_reg_query(&run.stdout) {
            let key = format!(
                "{}|{}",
                program.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase(),
                program.get("version").and_then(Value::as_str).unwrap_or("")
            );
            if seen.insert(key) {
                programs.push(program);
            }
        }
    }
    programs.sort_by(|a, b| {
        a.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase().cmp(&b.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase())
    });
    Ok(programs)
}

/// The single program whose Control Panel name matches `needle`
/// (case-insensitive substring); shortest name wins on ambiguity.
pub fn pick_program(programs: &[Value], needle: &str) -> Option<Value> {
    let query = needle.trim().to_lowercase();
    if query.is_empty() {
        return None;
    }
    let matches: Vec<&Value> = programs
        .iter()
        .filter(|program| program.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase().contains(&query))
        .collect();
    if matches.is_empty() {
        return None;
    }
    if let Some(exact) = matches.iter().find(|program| program.get("name").and_then(Value::as_str).unwrap_or("").trim().to_lowercase() == query) {
        return Some((*exact).clone());
    }
    let mut sorted: Vec<&Value> = matches;
    sorted.sort_by(|a, b| {
        let length_a = a.get("name").and_then(Value::as_str).unwrap_or("").len();
        let length_b = b.get("name").and_then(Value::as_str).unwrap_or("").len();
        length_a.cmp(&length_b).then_with(|| {
            a.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase().cmp(&b.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase())
        })
    });
    sorted.first().map(|program| (*program).clone())
}

/// Fallback for when Remote Registry is stopped: copy the machine's SOFTWARE
/// hive off \\host\C$ and read it locally with `reg load`.
#[allow(dead_code)]
pub async fn read_hive_over_share(host: &str, timeout_ms: u64) -> AppResult<Vec<Value>> {
    let clean = host.trim().trim_start_matches('\\').to_string();
    let candidates = vec![
        format!(r"\\{}\C$\Windows\System32\config\RegBack\SOFTWARE", clean),
        format!(r"\\{}\C$\Windows\repair\SOFTWARE", clean),
    ];
    let uuid = uuid::Uuid::new_v4().simple().to_string();
    let mount_name = format!("HFOFFLINE_{}_{}", clean.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect::<String>(), uuid);
    let temp_dir = std::env::temp_dir();
    let local_copy = temp_dir.join(format!("{mount_name}.hive"));

    let mut copied = false;
    for candidate in &candidates {
        let meta = tokio::fs::metadata(candidate).await;
        if let Ok(meta) = meta {
            if meta.len() > 0
                && tokio::fs::copy(candidate, &local_copy).await.is_ok() {
                    copied = true;
                    break;
                }
        }
    }
    if !copied {
        return Err(fail(&format!("No readable registry backup found on {clean}"), "HIVE_UNAVAILABLE"));
    }
    let local_string = local_copy.to_string_lossy().to_string();

    let load_args = vec!["load".to_string(), format!(r"HKLM\{mount_name}"), local_string.clone()];
    let load = tokio::task::spawn_blocking(move || run_reg(&load_args, timeout_ms)).await.map_err(|error| AppError::new(error.to_string()))?;
    if !load.ok {
        let _ = tokio::fs::remove_file(&local_copy).await;
        return Err(fail(&format!("Could not open the registry backup copied from {clean}"), "HIVE_LOAD_FAILED"));
    }
    let result: AppResult<Vec<Value>> = async {
        let mut programs: Vec<Value> = Vec::new();
        let mut any_ok = false;
        let mut seen = std::collections::HashSet::new();
        for key in UNINSTALL_KEYS {
            let args = vec!["query".to_string(), format!(r"HKLM\{mount_name}\{key}"), "/s".to_string()];
            let run = tokio::task::spawn_blocking(move || run_reg(&args, timeout_ms)).await.map_err(|error| AppError::new(error.to_string()))?;
            if run.ok {
                any_ok = true;
                for program in parse_reg_query(&run.stdout) {
                    let dedupe = format!(
                        "{}|{}",
                        program.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase(),
                        program.get("version").and_then(Value::as_str).unwrap_or("")
                    );
                    if seen.insert(dedupe) {
                        programs.push(program);
                    }
                }
            }
        }
        if !any_ok {
            return Err(AppError::new(format!("Could not query the registry backup from {clean}")));
        }
        programs.sort_by(|a, b| {
            a.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase().cmp(&b.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase())
        });
        Ok(programs)
    }
    .await;
    let unload_args = vec!["unload".to_string(), format!(r"HKLM\{mount_name}")];
    let _ = tokio::task::spawn_blocking(move || run_reg(&unload_args, 15000)).await;
    let _ = tokio::fs::remove_file(&local_copy).await;
    result
}
