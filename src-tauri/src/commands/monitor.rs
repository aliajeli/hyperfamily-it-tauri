//! `monitor:snapshot` — one manual snapshot for the dashboard on load; the
//! live stream rides the `monitor:update` event from the ping loop.

use super::{run_value, AppState, CmdResult};
use tauri::State;

#[tauri::command]
pub async fn monitor_snapshot(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || {
        let settings = state.database.get_settings()?;
        let history = settings.get("ping_history_count").and_then(serde_json::Value::as_i64).unwrap_or(30);
        state.database.get_monitor_snapshot(history)
    })
}
