//! `audit:list` — the audit trail browser on the About page.

use super::{run_value, AppState, CmdResult};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn audit_list(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || {
        let limit = payload.as_ref().and_then(Value::as_f64).map(|value| value as i64).unwrap_or(200);
        state.database.list_audit(limit).map(|rows| Value::Array(rows))
    })
}
