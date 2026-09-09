//! `app:*` and `remote:palette` — environment info, external links, and the
//! pre-auth theme broadcast into open device webviews.

use super::{AppState, CmdResult};
use crate::services::device_webview;
use serde_json::{json, Value};
use tauri::{Manager, State};

#[tauri::command]
pub async fn app_info(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    let package = app.package_info();
    let data_path = app
        .path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(json!({
        "version": package.version.to_string(),
        "platform": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "dataPath": data_path,
        "databasePath": state.database.file_path().to_string_lossy()
    }))
}

#[tauri::command]
pub async fn app_open_external(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let _ = state.actor()?;
    let value = payload.as_ref().and_then(Value::as_str).unwrap_or("").trim().to_string();
    // Only http(s) URLs may leave the app, matching the Electron handler.
    let url = if value.starts_with("http://") || value.starts_with("https://") {
        value.clone()
    } else {
        format!("https://{value}")
    };
    let pattern = regex::Regex::new(r"(?i)^https?://[^\s]+$").expect("static regex");
    if !pattern.is_match(&url) {
        return Err("That value is not a valid URL".into());
    }
    #[cfg(windows)]
    {
        let explorer = url.clone();
        tokio::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler".to_string(), explorer])
            .spawn()
            .map_err(|error| format!("The link could not be opened: {error}"))?;
    }
    #[cfg(not(windows))]
    {
        let _ = &url;
    }
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn app_path_exists(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let _ = state.actor()?;
    let value = payload.as_ref().and_then(Value::as_str).unwrap_or("");
    Ok(json!(std::fs::metadata(value).is_ok()))
}

/// Pre-auth on purpose (the login screen is themed too).
#[tauri::command]
pub async fn remote_palette(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let palette = payload.unwrap_or(json!({}));
    device_webview::broadcast_palette(&palette);
    let _ = state;
    Ok(json!(true))
}
