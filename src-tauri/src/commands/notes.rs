//! `notes:*` channels.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command(rename = "notes:list")]
pub async fn list(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || state.database.list_notes().map(|rows| Value::Array(rows)))
}

#[tauri::command(rename = "notes:save")]
pub async fn save(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || state.database.save_note(&payload.unwrap_or(json!({})), &actor).map(Value::from))
}

#[tauri::command(rename = "notes:remove")]
pub async fn remove(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || {
        let id = payload.as_ref().and_then(Value::as_i64).unwrap_or(0);
        state.database.delete_note(id, &actor).map(|ok| json!({ "success": ok }))
    })
}
