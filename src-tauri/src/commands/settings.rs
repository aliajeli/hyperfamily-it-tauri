//! `settings:*` channels.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command(rename = "settings:get")]
pub async fn get(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || state.database.get_settings())
}

#[tauri::command(rename = "settings:save")]
pub async fn save(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || state.database.save_settings(&payload.unwrap_or(json!({})), &actor))
}
