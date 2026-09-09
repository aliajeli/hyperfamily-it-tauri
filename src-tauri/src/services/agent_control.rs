//! Port of electron/services/agent-control.service.js — remote Windows service
//! control for the checkout Agent via `sc.exe \\HOST` and ServiceController.

use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

pub const SERVICE_NAME: &str = "HyperFamilyStoreAgent";
pub const AGENT_EXE: &str = "HyperFamilyStoreAgent.exe";
pub const AGENT_PATH: &str = r"C:\Agent\HyperFamilyStoreAgent.exe";

pub fn normalize_agent_host(host: &str) -> AppResult<String> {
    let clean = host.trim();
    if clean.is_empty() || clean.len() > 253 || !clean.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
        return Err(AppError::new("Invalid agent target hostname or IP"));
    }
    Ok(clean.to_string())
}

async fn run_sc(host: &str, args: &[&str], allowed: &[i32]) -> AppResult<(i32, String)> {
    let target = normalize_agent_host(host)?;
    let full: Vec<String> = std::iter::once(format!(r"\\{target}"))
        .chain(args.iter().map(|arg| arg.to_string()))
        .collect();
    let handle = tokio::task::spawn_blocking(move || crate::services::smb::run_command("sc.exe", &full, 20000))
        .await
        .map_err(|error| AppError::new(error.to_string()))?;
    if !handle.ok && !allowed.contains(&handle.code) {
        let detail = if handle.stderr.trim().is_empty() { handle.stdout.trim() } else { handle.stderr.trim() };
        return Err(AppError::new(format!(
            "Agent service control failed on {host} — {}. Allow Remote Service Management and check Target access administrator permissions",
            if detail.is_empty() { "the command could not run" } else { detail }
        )));
    }
    Ok((handle.code, handle.stdout))
}

async fn run_ps(script: &str, timeout_ms: u64) -> AppResult<String> {
    crate::services::software::run_ps(script, timeout_ms).await
}

fn ps_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub struct AgentControl;

impl AgentControl {
    pub fn new() -> Self {
        Self
    }

    pub async fn query(&self, host: &str) -> AppResult<Value> {
        normalize_agent_host(host)?;
        let (probe_code, _) = run_sc(host, &["query", SERVICE_NAME], &[1060]).await?;
        if probe_code == 1060 {
            return Ok(json!({ "exists": false, "state": "Missing" }));
        }
        // ServiceController uses SCM, not WMI, WinRM or Remote Registry. Its
        // enum names are invariant, unlike localized sc.exe table headings.
        let script = format!(
            r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.ServiceProcess
$service = New-Object System.ServiceProcess.ServiceController('{SERVICE_NAME}', {host})
try {{
  @{{ exists = $true; state = $service.Status.ToString() }} | ConvertTo-Json -Compress
}} catch {{
  $cause = $_.Exception
  while ($cause.InnerException) {{ $cause = $cause.InnerException }}
  if ($cause.NativeErrorCode -eq 1060) {{ '{{"exists":false,"state":"Missing"}}' }}
  else {{ throw 'Cannot query the agent service. Check Target access and Remote Service Management firewall permissions.' }}
}} finally {{ $service.Dispose() }}
"#,
            SERVICE_NAME = SERVICE_NAME,
            host = ps_literal(host),
        );
        let output = run_ps(&script, 15000).await?;
        let value: Value = serde_json::from_str(output.trim()).map_err(|error| AppError::new(format!("Agent service state was unreadable: {error}")))?;
        Ok(value)
    }

    pub async fn assert_owned_service(&self, host: &str) -> AppResult<()> {
        let (code, stdout) = run_sc(host, &["qc", SERVICE_NAME], &[1060]).await?;
        if code == 1060 {
            return Ok(());
        }
        // Refuse to repurpose an unrelated pre-existing service with the same name.
        let pattern = regex::Regex::new(r#"(?im)^\s*[^:\r\n]+:\s*"?C:\\Agent\\HyperFamilyStoreAgent\.exe"?\s*$"#).expect("static regex");
        if !pattern.is_match(&stdout) {
            return Err(AppError::new(
                "An existing HyperFamilyStoreAgent service points outside the expected agent executable; it was not changed",
            ));
        }
        Ok(())
    }

    pub async fn secure_directories(&self, host: &str) -> AppResult<()> {
        let target = normalize_agent_host(host)?;
        let root = format!(r"\\{}\C$\Agent", target);
        let script = format!(
            r#"
$ErrorActionPreference = 'Stop'
$root = {root}
foreach ($entry in @(@{{ Path = $root; AgentRights = 'ReadAndExecute' }}, @{{ Path = "$root\data"; AgentRights = 'Modify' }})) {{
  $item = Get-Item -LiteralPath $entry.Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {{ throw 'Agent directory must not be a reparse point' }}
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($grant in @(@{{ Sid='S-1-5-18'; Rights='FullControl' }}, @{{ Sid='S-1-5-32-544'; Rights='FullControl' }}, @{{ Sid='S-1-5-19'; Rights=$entry.AgentRights }})) {{
    $sid = New-Object System.Security.Principal.SecurityIdentifier($grant.Sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $grant.Rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }}
  (New-Object System.IO.DirectoryInfo($entry.Path)).SetAccessControl($acl)
}}
$exe = Join-Path $root '{AGENT_EXE}'
if (Test-Path -LiteralPath $exe) {{
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($false, $false)
  (New-Object System.IO.FileInfo($exe)).SetAccessControl($acl)
}}
"#,
            root = ps_literal(&root),
            AGENT_EXE = AGENT_EXE,
        );
        run_ps(&script, 20000).await.map(|_| ())
    }

    pub async fn wait_for(&self, host: &str, state: &str, timeout_ms: u64) -> AppResult<Value> {
        let end = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            let status = self.query(host).await?;
            if status.get("state").and_then(Value::as_str) == Some(state) {
                return Ok(status);
            }
            if Instant::now() >= end {
                return Err(AppError::new(format!("Agent service did not reach {state} on {host} in time")));
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    pub async fn stop(&self, host: &str) -> AppResult<()> {
        run_sc(host, &["stop", SERVICE_NAME], &[1062, 1060]).await?;
        let status = self.query(host).await?;
        if status.get("exists").and_then(Value::as_bool).unwrap_or(false) {
            self.wait_for(host, "Stopped", 45000).await?;
        }
        Ok(())
    }

    pub async fn configure(&self, host: &str, exists: bool) -> AppResult<()> {
        let verb = if exists { "config" } else { "create" };
        run_sc(
            host,
            &[verb, SERVICE_NAME, "binPath=", &format!("\"{AGENT_PATH}\""), "start=", "auto", "type=", "own", "obj=", r"NT AUTHORITY\LocalService", "password=", "", "DisplayName=", "HyperFamily Store Inventory Agent"],
            &[],
        )
        .await?;
        run_sc(host, &["description", SERVICE_NAME, "Read-only local software inventory for HyperFamily Branch Monitor."], &[]).await?;
        run_sc(host, &["failure", SERVICE_NAME, "reset=", "86400", "actions=", "restart/5000/restart/15000/restart/60000"], &[]).await?;
        Ok(())
    }

    pub async fn start(&self, host: &str) -> AppResult<()> {
        run_sc(host, &["start", SERVICE_NAME], &[1056]).await?;
        self.wait_for(host, "Running", 45000).await?;
        Ok(())
    }

    pub async fn remove(&self, host: &str) -> AppResult<()> {
        run_sc(host, &["delete", SERVICE_NAME], &[1060]).await?;
        Ok(())
    }
}

impl Default for AgentControl {
    fn default() -> Self {
        Self::new()
    }
}
