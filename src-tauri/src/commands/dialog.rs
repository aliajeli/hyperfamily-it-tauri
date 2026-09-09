//! `dialog:*` — the three native pickers the version checker and deployment
//! tools rely on. Electron-style `filters` arrays are honoured.

use super::{AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

fn apply_filters<R: tauri::Runtime>(
    mut builder: tauri_plugin_dialog::FileDialogBuilder<R>,
    filters: Option<&Vec<Value>>,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    let Some(filters) = filters else { return builder };
    for filter in filters {
        let name = filter.get("name").and_then(Value::as_str).unwrap_or("Files");
        let extensions: Vec<String> = filter
            .get("extensions")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(Value::as_str).map(String::from).collect())
            .unwrap_or_default();
        let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(name, &refs);
    }
    builder
}

#[tauri::command(rename = "dialog:select-file")]
pub async fn select_file(app: tauri::AppHandle, state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let _ = state.actor()?;
    let options = payload.unwrap_or(json!({}));
    let title = options.get("title").and_then(Value::as_str).unwrap_or("Select file").to_string();
    let filters = options.get("filters").and_then(Value::as_array).cloned();
    let picked = tokio::task::spawn_blocking(move || {
        let builder = app.dialog().file().set_title(&title);
        apply_filters(builder, filters.as_ref()).blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(match picked {
        Some(path) => json!(path.into_path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()),
        None => Value::Null,
    })
}

#[tauri::command(rename = "dialog:select-files")]
pub async fn select_files(app: tauri::AppHandle, state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let _ = state.actor()?;
    let options = payload.unwrap_or(json!({}));
    let title = options.get("title").and_then(Value::as_str).unwrap_or("Select files").to_string();
    let filters = options.get("filters").and_then(Value::as_array).cloned();
    let picked = tokio::task::spawn_blocking(move || {
        let builder = app.dialog().file().set_title(&title);
        apply_filters(builder, filters.as_ref()).blocking_pick_files()
    })
    .await
    .map_err(|error| error.to_string())?;
    let paths: Vec<String> = picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    Ok(json!(paths))
}

#[tauri::command(rename = "dialog:select-directory")]
pub async fn select_directory(app: tauri::AppHandle, state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let _ = state.actor()?;
    let options = payload.unwrap_or(json!({}));
    let title = options.get("title").and_then(Value::as_str).unwrap_or("Select folder").to_string();
    let picked = tokio::task::spawn_blocking(move || app.dialog().file().set_title(&title).blocking_pick_folder())
        .await
        .map_err(|error| error.to_string())?;
    Ok(match picked {
        Some(path) => json!(path.into_path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()),
        None => Value::Null,
    })
}
