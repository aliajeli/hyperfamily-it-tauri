//! `update:*` — the About page update card. Download/install ride the
//! signature-verified Tauri updater; pause semantics match Electron exactly.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

/// Await an async service call from the sync command body.
fn futures_now<F: std::future::Future>(future: F) -> Result<F::Output, String> {
    tokio::task::block_in_place(|| tauri::async_runtime::block_on(future))
}

#[tauri::command(rename = "update:check")]
pub async fn check(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || futures_now(state.update.check()))
}

#[tauri::command(rename = "update:state")]
pub async fn state_of(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || Ok(state.update.state()))
}

#[tauri::command(rename = "update:download")]
pub async fn download(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let cancel = state.update_cancel.clone();
    run_value(move || {
        cancel.store(false, std::sync::atomic::Ordering::Relaxed);
        futures_now(state.update.download(cancel))
    })
}

#[tauri::command(rename = "update:pause")]
pub async fn pause(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let cancel = state.update_cancel.clone();
    run_value(move || futures_now(state.update.pause(&cancel)))
}

#[tauri::command(rename = "update:resume")]
pub async fn resume(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let cancel = state.update_cancel.clone();
    run_value(move || futures_now(state.update.resume(&cancel)))
}

#[tauri::command(rename = "update:stop")]
pub async fn stop(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let cancel = state.update_cancel.clone();
    run_value(move || futures_now(state.update.stop(&cancel)))
}

#[tauri::command(rename = "update:install")]
pub async fn install(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let _ = actor;
    run_value(move || futures_now(state.update.install()))
}
