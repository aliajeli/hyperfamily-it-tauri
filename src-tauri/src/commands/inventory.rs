//! `inventory:*` — list + Excel export (save dialog included, like Electron).

use super::{run_value, AppState, CmdResult};
use crate::services::excel::ExcelService;
use serde_json::Value;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn inventory_list(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || state.database.list_inventory().map(Value::Array))
}

#[tauri::command]
pub async fn inventory_export(app: tauri::AppHandle, state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let _ = state.actor()?;
    let filters = payload.unwrap_or_default();
    let branch = filters.get("branch").and_then(Value::as_str).unwrap_or("all");
    let device_type = filters.get("type").and_then(Value::as_str).unwrap_or("all");
    let date = chrono::Utc::now().format("%Y-%m-%d");
    let default_name = format!(
        "Inventory_{}_{}_{}.xlsx",
        crate::services::excel::excel_clean(branch),
        crate::services::excel::excel_clean(device_type),
        date
    );
    let picked = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Save inventory workbook")
            .set_file_name(&default_name)
            .add_filter("Excel workbook", &["xlsx"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(picked) = picked else { return Ok(serde_json::json!({ "canceled": true })) };
    let path = picked
        .into_path()
        .map_err(|error| error.to_string())?;
    let path = ensure_xlsx(path);
    run_value(move || ExcelService::new(&state.database).export_inventory(&filters, &path))
}

fn ensure_xlsx(path: std::path::PathBuf) -> std::path::PathBuf {
    if path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("xlsx")).unwrap_or(false) {
        path
    } else {
        let mut name = path.into_os_string();
        name.push(".xlsx");
        std::path::PathBuf::from(name)
    }
}
