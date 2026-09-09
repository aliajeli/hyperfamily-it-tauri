//! Port of electron/services/software.service.js — local installed-programs
//! inventory, executable file versions, streamed SHA-256 verified copies.

use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub const LIST_INSTALLED_SCRIPT: &str = r#"
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and -not $_.SystemComponent } |
  Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, DisplayIcon |
  ConvertTo-Json -Compress -Depth 2
"#;

/// Runs a PowerShell command and resolves with its stdout.
pub async fn run_ps(script: &str, timeout_ms: u64) -> AppResult<String> {
    let encoded: String = {
        // -EncodedCommand expects UTF-16LE base64.
        let utf16: Vec<u16> = script.encode_utf16().collect();
        let bytes: Vec<u8> = utf16.iter().flat_map(|unit| unit.to_le_bytes()).collect();
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
    };
    let mut args = vec![
        "-NoProfile".to_string(),
        "-NonInteractive".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-EncodedCommand".to_string(),
        encoded,
    ];
    args.shrink_to_fit();
    let handle = tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        tokio::process::Command::new("powershell.exe")
            .args(&args)
            .stdin(std::process::Stdio::null())
            .creation_flags_np()
            .output(),
    )
    .await;
    match handle {
        Err(_) => Err(AppError::new("The PowerShell command timed out")),
        Ok(Err(error)) => Err(AppError::new(format!("PowerShell could not be started: {error}"))),
        Ok(Ok(output)) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(AppError::new(if stderr.is_empty() {
                    format!("The PowerShell command failed with status {}", output.status)
                } else {
                    stderr
                }));
            }
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        }
    }
}

/// `creation_flags` shim so the helper above stays platform tidy.
trait CreationFlagsNp {
    fn creation_flags_np(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl CreationFlagsNp for tokio::process::Command {
    fn creation_flags_np(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(0x08000000)
    }
}

#[cfg(not(windows))]
impl CreationFlagsNp for tokio::process::Command {
    fn creation_flags_np(&mut self) -> &mut Self {
        self
    }
}

/// JSON output may arrive as a single object when exactly one program exists.
pub fn parse_installed_json(output: &str) -> Vec<Value> {
    let text = output.trim();
    if text.is_empty() {
        return vec![];
    }
    let parsed: Value = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(_) => return vec![],
    };
    let rows: Vec<Value> = match parsed {
        Value::Array(rows) => rows,
        Value::Object(_) => vec![parsed],
        _ => vec![],
    };
    let mut programs: Vec<Value> = rows
        .into_iter()
        .filter_map(|row| {
            let name = row.get("DisplayName").and_then(Value::as_str)?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let raw_icon = row.get("DisplayIcon").and_then(Value::as_str).unwrap_or("").trim().to_string();
            // DisplayIcon often looks like `"C:\path\app.exe",0` — cut at the
            // closing quote instead of the first comma.
            let display_icon = if let Some(end) = raw_icon.strip_prefix('"').and_then(|rest| rest.find('"')) {
                raw_icon[1..end].to_string()
            } else {
                raw_icon.split(',').next().unwrap_or("").trim().to_string()
            };
            Some(json!({
                "name": name,
                "version": row.get("DisplayVersion").and_then(Value::as_str).unwrap_or("").trim(),
                "publisher": row.get("Publisher").and_then(Value::as_str).unwrap_or("").trim(),
                "installLocation": row.get("InstallLocation").and_then(Value::as_str).unwrap_or("").trim(),
                "displayIcon": display_icon
            }))
        })
        .collect();
    programs.sort_by(|a, b| {
        a.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase().cmp(&b.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase())
    });
    programs
}

/// Streams a file through SHA-256; used to prove a copy landed intact.
pub async fn sha256_file(file: &Path) -> AppResult<String> {
    let path = file.to_path_buf();
    tokio::task::spawn_blocking(move || -> AppResult<String> {
        use std::io::Read;
        let mut file = std::fs::File::open(&path)?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        Ok(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|error| AppError::new(error.to_string()))?
}

/// Streamed copy with live progress; `on_progress` receives (written, total).
pub async fn stream_copy(
    source: &Path,
    target: &Path,
    total: u64,
    on_progress: impl Fn(u64, u64) + Send + 'static,
    timeout_ms: u64,
) -> AppResult<()> {
    let source = source.to_path_buf();
    let target = target.to_path_buf();
    let task = tokio::task::spawn_blocking(move || -> AppResult<()> {
        use std::io::{Read, Write};
        let mut input = std::fs::File::open(&source)?;
        let mut output = std::fs::File::create(target)?;
        let mut written = 0u64;
        let mut buffer = vec![0u8; 256 * 1024];
        loop {
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read])?;
            written += read as u64;
            on_progress(written, total);
        }
        output.flush()?;
        Ok(())
    });
    match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), task).await {
        Err(_) => Err(AppError::new("The copy stalled and was aborted")),
        Ok(Err(error)) => Err(AppError::new(error.to_string())),
        Ok(Ok(result)) => result,
    }
}

pub fn require_windows(action: &str) -> AppResult<()> {
    if cfg!(windows) {
        Ok(())
    } else {
        Err(AppError::new(format!("{action} is only available on Windows")))
    }
}

pub struct SoftwareService {
    cache: parking_lot::Mutex<(Option<Vec<Value>>, Instant)>,
}

impl SoftwareService {
    pub fn new() -> Self {
        Self { cache: parking_lot::Mutex::new((None, Instant::now() - std::time::Duration::from_secs(3600))) }
    }

    /// All programs registered with Windows Install/Uninstall, cached for 60 s.
    pub async fn list_installed(&self, force: bool) -> AppResult<Vec<Value>> {
        require_windows("Listing installed programs")?;
        {
            let cache = self.cache.lock();
            if !force && cache.0.is_some() && cache.1.elapsed() < std::time::Duration::from_secs(60) {
                return Ok(cache.0.clone().expect("checked above"));
            }
        }
        let output = run_ps(LIST_INSTALLED_SCRIPT, 60000).await?;
        let programs = parse_installed_json(&output);
        *self.cache.lock() = (Some(programs.clone()), Instant::now());
        Ok(programs)
    }

    /// Two lookup modes: `{ path }` or `{ name }`.
    pub async fn check_version(&self, payload: &Value) -> AppResult<Value> {
        let file_path = payload.get("path").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let name = payload.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if !file_path.is_empty() {
            return self.get_file_version(&file_path).await;
        }
        if name.is_empty() {
            return Err(AppError::new("Enter a program name or choose an executable file"));
        }
        let programs = self.list_installed(false).await?;
        let needle = name.to_lowercase();
        let matches: Vec<Value> = programs
            .into_iter()
            .filter(|program| program.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase().contains(&needle))
            .take(25)
            .collect();
        Ok(json!({
            "mode": "installed", "query": name,
            "matches": matches,
            "checkedAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        }))
    }

    /// File/Product version of one executable plus its statistics.
    pub async fn get_file_version(&self, file_path: &str) -> AppResult<Value> {
        require_windows("Reading a file version")?;
        let path = PathBuf::from(file_path);
        if !path.is_absolute() {
            return Err(AppError::new("The file path must be absolute"));
        }
        let meta = tokio::fs::metadata(&path).await.map_err(|_| AppError::new(format!("File not found: {file_path}")))?;
        let script = format!(
            "$p = {}; $i = Get-Item -LiteralPath $p; $v = $i.VersionInfo; [pscustomobject]@{{ FileVersion = $v.FileVersion; ProductVersion = $v.ProductVersion; ProductName = $v.ProductName; CompanyName = $v.CompanyName; FileDescription = $v.FileDescription }} | ConvertTo-Json -Compress",
            ps_literal(file_path)
        );
        let info = match run_ps(&script, 30000).await {
            Ok(text) => serde_json::from_str::<Value>(text.trim()).unwrap_or(json!({})),
            Err(_) => json!({}),
        };
        let file_name = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
        let modified = meta
            .modified()
            .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .unwrap_or_default();
        Ok(json!({
            "mode": "file",
            "path": file_path,
            "fileName": file_name,
            "fileVersion": info.get("FileVersion").and_then(Value::as_str).unwrap_or(""),
            "productVersion": info.get("ProductVersion").and_then(Value::as_str).unwrap_or(""),
            "productName": info.get("ProductName").and_then(Value::as_str).unwrap_or(""),
            "companyName": info.get("CompanyName").and_then(Value::as_str).unwrap_or(""),
            "fileDescription": info.get("FileDescription").and_then(Value::as_str).unwrap_or(""),
            "sizeBytes": meta.len(),
            "modifiedAt": modified
        }))
    }

    /// Copies every source file into the destination folder with progress +
    /// SHA-256 verification. One bad file never aborts the batch.
    pub async fn copy_files(&self, payload: &Value, emit: &crate::services::Emitter) -> AppResult<Value> {
        require_windows("Copying files")?;
        let sources: Vec<String> = payload
            .get("sources")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(Value::as_str).map(|text| text.trim().to_string()).filter(|text| !text.is_empty()).collect())
            .unwrap_or_default();
        let destination = payload.get("destination").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let overwrite = payload.get("overwrite").and_then(Value::as_bool).unwrap_or(false);
        let verify = payload.get("verify").and_then(Value::as_bool).unwrap_or(true);
        if sources.is_empty() {
            return Err(AppError::new("Add at least one file to copy"));
        }
        if sources.len() > 200 {
            return Err(AppError::new("A single copy run is limited to 200 files"));
        }
        if destination.is_empty() {
            return Err(AppError::new("Choose a destination folder"));
        }
        let destination_path = PathBuf::from(&destination);
        if !destination_path.is_absolute() {
            return Err(AppError::new("The destination must be an absolute path"));
        }
        if let Ok(meta) = tokio::fs::metadata(&destination_path).await {
            if !meta.is_dir() {
                return Err(AppError::new("The destination exists and is not a folder"));
            }
        }
        tokio::fs::create_dir_all(&destination_path).await?;

        let started = Instant::now();
        let mut results: Vec<Value> = Vec::new();
        let mut copied_bytes = 0u64;
        for (index, source) in sources.iter().enumerate() {
            let source_path = PathBuf::from(source);
            let file_name = source_path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
            let target_path = destination_path.join(&file_name);
            let target = target_path.to_string_lossy().to_string();
            let emit_step = |state: &str, extra: Value| {
                let mut event = json!({ "index": index, "source": source, "target": target, "state": state });
                if let (Value::Object(base), Value::Object(additions)) = (&mut event, &extra) {
                    for (key, value) in additions {
                        base.insert(key.clone(), value.clone());
                    }
                }
                emit("software:copy-progress", event);
            };
            let source_text = source.clone();
            if !source_path.is_absolute() {
                results.push(json!({ "source": source_text, "target": target, "bytes": 0, "state": "error", "error": "The source must be an absolute path" }));
                continue;
            }
            let meta = match tokio::fs::metadata(&source_path).await {
                Ok(meta) if meta.is_file() => meta,
                Ok(_) => {
                    results.push(json!({ "source": source_text, "target": target, "bytes": 0, "state": "error", "error": "The source is not a file" }));
                    emit_step("error", json!({ "percent": 0, "error": "The source is not a file" }));
                    continue;
                }
                Err(_) => {
                    results.push(json!({ "source": source_text, "target": target, "bytes": 0, "state": "error", "error": "Source file not found" }));
                    emit_step("error", json!({ "percent": 0, "error": "Source file not found" }));
                    continue;
                }
            };
            let total = meta.len();
            if tokio::fs::try_exists(&target_path).await.unwrap_or(false) && !overwrite {
                results.push(json!({ "source": source_text, "target": target, "bytes": 0, "state": "skipped", "error": "Already exists at the destination" }));
                emit_step("skipped", json!({ "percent": 100, "written": total, "total": total }));
                continue;
            }
            emit_step("started", json!({ "percent": 0, "written": 0, "total": total }));

            // Progress crosses from the blocking copy thread through a channel
            // so the `&dyn Fn` emitter never has to be `Send + 'static`.
            let (progress_tx, progress_rx) = std::sync::mpsc::channel::<(u64, u64)>();
            let drain = tokio::task::spawn({
                let source_text = source_text.clone();
                let target_text = target.clone();
                let emit = emit.clone();
                async move {
                    let mut last = Instant::now() - std::time::Duration::from_secs(1);
                    while let Ok((written, total_bytes)) = progress_rx.recv() {
                        if written != total_bytes && last.elapsed() < std::time::Duration::from_millis(100) {
                            continue;
                        }
                        last = Instant::now();
                        let percent = if total_bytes > 0 { (written * 100 / total_bytes) as i64 } else { 100 };
                        emit(
                            "software:copy-progress",
                            json!({ "index": index, "source": source_text, "target": target_text, "state": "progress",
                                    "percent": percent, "written": written, "total": total_bytes }),
                        );
                    }
                }
            });
            let copy_outcome = {
                let progress_tx = progress_tx.clone();
                let outcome = stream_copy(&source_path, &target_path, total, move |written, total_bytes| {
                    let _ = progress_tx.send((written, total_bytes));
                }, 15 * 60 * 1000)
                .await;
                drop(progress_tx);
                let _ = drain.await;
                outcome
            };
            if let Err(error) = copy_outcome {
                results.push(json!({ "source": source_text, "target": target, "bytes": 0, "state": "error", "error": error.message }));
                emit_step("error", json!({ "percent": 0, "error": error.message }));
                continue;
            }
            let mut verified: Option<bool> = None;
            let mut sha_source: Option<String> = None;
            let mut sha_target: Option<String> = None;
            if verify {
                emit_step("verifying", json!({ "percent": 100, "written": total, "total": total }));
                let (source_hash, target_hash) = tokio::join!(sha256_file(&source_path), sha256_file(&target_path));
                let (Ok(source_hash), Ok(target_hash)) = (source_hash, target_hash) else {
                    results.push(json!({ "source": source_text, "target": target, "bytes": 0, "state": "error", "error": "SHA-256 could not be computed" }));
                    continue;
                };
                sha_source = Some(source_hash.clone());
                sha_target = Some(target_hash.clone());
                let matches = source_hash == target_hash;
                verified = Some(matches);
                if !matches {
                    results.push(json!({ "source": source_text, "target": target, "bytes": 0, "state": "error", "error": "SHA-256 verification failed after copying" }));
                    emit_step("error", json!({ "percent": 0, "error": "SHA-256 verification failed after copying" }));
                    continue;
                }
            }
            copied_bytes += total;
            results.push(json!({ "source": source_text, "target": target, "bytes": total, "sha256Source": sha_source, "sha256Target": sha_target, "verified": verified, "state": "copied" }));
            emit_step("copied", json!({ "percent": 100, "written": total, "total": total, "verified": verified }));
        }
        let copied = results.iter().filter(|row| row.get("state").and_then(Value::as_str) == Some("copied")).count();
        let skipped = results.iter().filter(|row| row.get("state").and_then(Value::as_str) == Some("skipped")).count();
        let failed = results.iter().filter(|row| row.get("state").and_then(Value::as_str) == Some("error")).count();
        let summary = json!({
            "results": results,
            "copied": copied,
            "skipped": skipped,
            "failed": failed,
            "totalBytes": copied_bytes,
            "durationMs": started.elapsed().as_millis() as u64
        });
        emit("software:copy-progress", json!({ "state": "finished", "summary": summary }));
        Ok(summary)
    }
}

/// PowerShell single-quoted literal; interior quotes are doubled.
pub fn ps_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

impl Default for SoftwareService {
    fn default() -> Self {
        Self::new()
    }
}
