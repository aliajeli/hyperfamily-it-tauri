//! `terminal:*` — the five in-app terminal channels (open/write/resize/close/
//! targets). Data and status flow back over `terminal:data`/`terminal:status`.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn terminal_targets(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || state.terminal.targets().map(|rows| Value::Array(rows)))
}

#[tauri::command]
pub async fn terminal_open(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let payload = payload.unwrap_or(json!({}));
    run_value(move || state.terminal.open(&payload, &actor))
}

#[tauri::command]
pub async fn terminal_write(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let payload = payload.unwrap_or(json!({}));
    run_value(move || {
        let session_id = payload.get("sessionId").and_then(Value::as_str).unwrap_or("");
        let data = payload.get("data").and_then(Value::as_str).unwrap_or("");
        state.terminal.write(session_id, data).map(|ok| json!(ok))
    })
}

#[tauri::command]
pub async fn terminal_resize(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let payload = payload.unwrap_or(json!({}));
    run_value(move || {
        let session_id = payload.get("sessionId").and_then(Value::as_str).unwrap_or("");
        let cols = payload.get("cols").and_then(Value::as_f64).map(|value| value as u32).unwrap_or(80);
        let rows = payload.get("rows").and_then(Value::as_f64).map(|value| value as u32).unwrap_or(24);
        state.terminal.resize(session_id, cols, rows).map(|ok| json!(ok))
    })
}

#[tauri::command]
pub async fn terminal_close(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let session_id = payload.as_ref().and_then(Value::as_str).unwrap_or("").to_string();
    run_value(move || state.terminal.close(&session_id, "Closed by the operator").map(|ok| json!(ok)))
}
