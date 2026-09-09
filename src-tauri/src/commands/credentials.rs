//! `credentials:*` channels — vault-backed credential store, device/type
//! assignments, and the reveal flow.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command(rename = "credentials:list")]
pub async fn list(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || state.database.list_credentials().map(|rows| Value::Array(rows)))
}

#[tauri::command(rename = "credentials:reveal")]
pub async fn reveal(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || {
        let id = payload.as_ref().and_then(Value::as_i64).unwrap_or(0);
        let secret = state.database.reveal_credential(id)?;
        state.database.audit(&actor, "CREDENTIAL_REVEAL", &id.to_string(), "Credential revealed");
        Ok(json!({ "secret": secret }))
    })
}

#[tauri::command(rename = "credentials:save")]
pub async fn save(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || state.database.save_credential(&payload.unwrap_or(json!({})), &actor).map(Value::from))
}

#[tauri::command(rename = "credentials:remove")]
pub async fn remove(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || {
        let id = payload.as_ref().and_then(Value::as_i64).unwrap_or(0);
        state.database.delete_credential(id, &actor).map(|ok| json!({ "success": ok }))
    })
}

#[tauri::command(rename = "credentials:mappings")]
pub async fn mappings(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || Ok(state.database.get_credential_map()))
}

#[tauri::command(rename = "credentials:credential-map")]
pub async fn credential_map(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || Ok(state.database.get_credential_map()))
}

#[tauri::command(rename = "credentials:for-device")]
pub async fn for_device(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || {
        let device_id = payload.as_ref().and_then(Value::as_f64).map(|value| value as i64).unwrap_or(0);
        state.database.list_credentials_for_device(device_id).map(|rows| Value::Array(rows))
    })
}

#[tauri::command(rename = "credentials:save-mappings")]
pub async fn save_mappings(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || state.database.save_mappings(&payload.unwrap_or(json!({})), &actor))
}

#[tauri::command(rename = "credentials:assign-device")]
pub async fn assign_device(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || {
        let payload = payload.unwrap_or(json!({}));
        let device_id = payload.get("deviceId").and_then(Value::as_f64).map(|value| value as i64).unwrap_or(0);
        let credential_id = payload.get("credentialId").and_then(Value::as_i64);
        state.database.set_device_credential(device_id, credential_id, &actor)
    })
}

#[tauri::command(rename = "credentials:assign-type")]
pub async fn assign_type(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || {
        let payload = payload.unwrap_or(json!({}));
        let device_type = payload.get("deviceType").and_then(Value::as_str).unwrap_or("");
        let credential_id = payload.get("credentialId").and_then(Value::as_i64);
        state.database.set_type_credential(device_type, credential_id, &actor)
    })
}

#[tauri::command(rename = "credentials:overview")]
pub async fn overview(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || state.database.list_device_credential_overview().map(|rows| Value::Array(rows)))
}
