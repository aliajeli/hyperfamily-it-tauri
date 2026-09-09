//! `directory:*` — template download and atomic workbook import, each with
//! its native file dialog exactly like the Electron handlers.

use super::{run_value, AppState, CmdResult};
use crate::services::excel::ExcelService;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command(rename = "directory:template")]
pub async fn template(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let picked = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Save HyperFamily Excel file")
            .set_file_name("HyperFamily-Import-Template.xlsx")
            .add_filter("Excel Workbook", &["xlsx"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(picked) = picked else { return Ok(serde_json::json!({ "canceled": true })) };
    let path = picked.into_path().map_err(|error| error.to_string())?;
    let path = if path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("xlsx")).unwrap_or(false) {
        path
    } else {
        let mut name = path.into_os_string();
        name.push(".xlsx");
        std::path::PathBuf::from(name)
    };
    run_value(move || ExcelService::new(&state.database).create_template(&path, &actor))
}

#[tauri::command(rename = "directory:import")]
pub async fn import(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let picked = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import HyperFamily directory")
            .add_filter("Excel Workbook", &["xlsx"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(picked) = picked else { return Ok(serde_json::json!({ "canceled": true })) };
    let path = picked.into_path().map_err(|error| error.to_string())?;
    run_value(move || ExcelService::new(&state.database).import_directory(&path, &actor))
}
