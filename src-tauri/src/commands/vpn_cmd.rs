//! `vpn:*` — status, probe, connect (global/FortiClient), disconnect and the
//! Settings → VPN diagnostics engine.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

/// Await an async service call from the sync command body.
fn futures_now<F: std::future::Future>(future: F) -> F::Output {
    tokio::task::block_in_place(|| tauri::async_runtime::block_on(future))
}

#[tauri::command(rename = "vpn:status")]
pub async fn status(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || Ok(state.vpn.status_value(None)))
}

#[tauri::command(rename = "vpn:probe")]
pub async fn probe(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || Ok(state.vpn.probe()))
}

#[tauri::command(rename = "vpn:connect")]
pub async fn connect(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let mode = payload.as_ref().and_then(Value::as_str).unwrap_or("").to_string();
    run_value(move || futures_now(state.vpn.connect(&mode, &actor)))
}

#[tauri::command(rename = "vpn:disconnect")]
pub async fn disconnect(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    run_value(move || futures_now(state.vpn.disconnect(&actor)))
}

#[tauri::command(rename = "vpn:diagnose")]
pub async fn diagnose(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || Ok(futures_now(state.vpn.diagnose())))
}
