//! `branches:*` and `devices:*` channels — the directory editor.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command(rename = "branches:list")]
pub async fn list(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || state.database.list_branches().map(Value::from))
}

#[tauri::command(rename = "branches:save")]
pub async fn save(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || {
        state.database.save_branch(&payload.unwrap_or(json!({})), &actor).map(Value::from)
    })
}

#[tauri::command(rename = "branches:remove")]
pub async fn remove(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || {
        let id = payload.as_ref().and_then(Value::as_i64).unwrap_or(0);
        state.database.delete_branch(id, &actor).map(Value::from)
    })
}

#[tauri::command(rename = "branches:remove-all")]
pub async fn remove_all(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || state.database.delete_all_branches_and_devices(&actor).map(Value::from))
}
