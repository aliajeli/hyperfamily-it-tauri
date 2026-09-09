//! `snippets:*` channels.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn snippets_list(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || state.database.list_snippets().map(Value::Array))
}

#[tauri::command]
pub async fn snippets_save(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || state.database.save_snippet(&payload.unwrap_or(json!({})), &actor))
}

#[tauri::command]
pub async fn snippets_remove(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || {
        let id = payload.as_ref().and_then(Value::as_i64).unwrap_or(0);
        state.database.delete_snippet(id, &actor).map(|ok| json!({ "success": ok }))
    })
}
