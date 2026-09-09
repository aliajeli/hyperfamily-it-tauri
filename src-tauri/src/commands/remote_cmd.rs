//! `remote:connect` / `remote:probe` — launches RDP, TeamViewer, Winbox and
//! browser sessions; `webview` opens a themed in-app device window.

use super::{run_value, AppState, CmdResult};
use crate::services::device_webview;
use crate::services::remote::RemoteService;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

/// Await an async service call from the sync command body.
fn futures_now<F: std::future::Future>(future: F) -> Result<F::Output, String> {
    tokio::task::block_in_place(|| tauri::async_runtime::block_on(future))
}

#[tauri::command(rename = "remote:connect")]
pub async fn connect(app: AppHandle, state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let request = payload.unwrap_or(json!({}));
    let palette = request.get("palette").cloned().unwrap_or(json!({}));
    let method = request.get("method").and_then(Value::as_str).unwrap_or("").to_string();
    run_value(move || {
        let result = futures_now(RemoteService::new(state.database.clone()).connect(&request, &actor))?;
        if method == "webview" && result.get("deviceId").is_some() {
            // Auto sign-in is a global preference; the renderer only supplies the palette.
            let settings = state.database.get_settings()?;
            let autologin = settings.get("webview_autologin").and_then(Value::as_bool).unwrap_or(true);
            let device_id = result.get("deviceId").cloned().unwrap_or(Value::Null);
            let title = result.get("title").and_then(Value::as_str).unwrap_or("Device").to_string();
            let kind = result.get("kind").and_then(Value::as_str).unwrap_or("ilo").to_string();
            let url = result.get("url").and_then(Value::as_str).unwrap_or("").to_string();
            let username = result.get("username").and_then(Value::as_str).unwrap_or("").to_string();
            let password = result.get("password").and_then(Value::as_str).unwrap_or("").to_string();
            return device_webview::open_device_webview(&app, device_id, &title, &kind, &url, &username, &password, palette, autologin)
                .map_err(crate::error::AppError::new);
        }
        Ok(result)
    })
}

#[tauri::command(rename = "remote:probe")]
pub async fn probe(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || Ok(RemoteService::new(state.database.clone()).probe()))
}
