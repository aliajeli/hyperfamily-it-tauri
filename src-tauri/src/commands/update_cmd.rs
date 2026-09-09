//! `update:*` — the About page update card. Download/install ride the
//! signature-verified Tauri updater; pause semantics match Electron exactly.

use super::{run_value, AppState, CmdResult};
use tauri::State;

/// Await an async service call from the sync command body.
fn futures_now<F: std::future::Future>(future: F) -> F::Output {
    tokio::task::block_in_place(|| tauri::async_runtime::block_on(future))
}

#[tauri::command]
pub async fn update_check(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || futures_now(state.update.check()))
}

#[tauri::command]
pub async fn update_state(state: State<'_, AppState>) -> CmdResult {
    let _ = state.actor()?;
    run_value(move || Ok(state.update.state()))
}

#[tauri::command]
pub async fn update_download(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let cancel = state.update_cancel.clone();
    run_value(move || {
        cancel.store(false, std::sync::atomic::Ordering::Relaxed);
        futures_now(state.update.download(cancel))
    })
}

#[tauri::command]
pub async fn update_pause(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let cancel = state.update_cancel.clone();
    run_value(move || futures_now(state.update.pause(&cancel)))
}

#[tauri::command]
pub async fn update_resume(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let cancel = state.update_cancel.clone();
    run_value(move || futures_now(state.update.resume(&cancel)))
}

#[tauri::command]
pub async fn update_stop(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let cancel = state.update_cancel.clone();
    run_value(move || futures_now(state.update.stop(&cancel)))
}

#[tauri::command]
pub async fn update_install(state: State<'_, AppState>) -> CmdResult {
    let actor = state.actor()?;
    let _ = actor;
    run_value(move || futures_now(state.update.install()))
}
