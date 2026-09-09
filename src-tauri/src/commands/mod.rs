//! The command layer: one `#[tauri::command]` per Electron IPC channel, with
//! the SAME names (`auth:login`, `store-update:deploy`, …) so the renderer
//! bridge stays a 1:1 translation of electron/preload/index.js.
//!
//! Every command takes at most one `payload` value — the preload shim packs
//! the original positional arguments into it, exactly like the Electron
//! renderer passed them.

pub mod app_cmd;
pub mod audit;
pub mod auth;
pub mod branches;
pub mod credentials;
pub mod devices;
pub mod dialog;
pub mod directory;
pub mod inventory;
pub mod monitor;
pub mod notes;
pub mod remote_cmd;
pub mod settings;
pub mod snippets;
pub mod store_update_cmd;
pub mod terminal_cmd;
pub mod update_cmd;
pub mod vpn_cmd;

use crate::db::AppDatabase;
use crate::services::smb::SmbSessionManager;
use crate::services::store_agent::StoreAgentService;
use crate::services::store_update::StoreUpdateService;
use crate::services::terminal::TerminalService;
use crate::services::updater::UpdateService;
use crate::services::vault::SecureVault;
use crate::services::vpn::VpnService;
use serde_json::Value;
use std::sync::Arc;

/// Everything a command may touch, shared behind `Arc`.
pub struct AppState {
    pub database: Arc<AppDatabase>,
    #[allow(dead_code)] // handle parity with Electron ipc-handlers; the db owns the live vault
    pub vault: Arc<SecureVault>,
    pub smb: Arc<SmbSessionManager>,
    pub store_update: Arc<StoreUpdateService>,
    pub store_agent: Arc<StoreAgentService>,
    pub vpn: Arc<VpnService>,
    pub terminal: Arc<TerminalService>,
    pub update: Arc<UpdateService>,
    pub emitter: crate::services::Emitter,
    /// The single desktop session (the Electron build kept one per window;
    /// there is exactly one main window here).
    pub session: parking_lot::Mutex<Option<Value>>,
    pub update_cancel: Arc<std::sync::atomic::AtomicBool>,
}

impl AppState {
    /// `secure` guard from ipc-handlers.js: rejects when nobody signed in and
    /// returns the acting username for audit records.
    pub fn actor(&self) -> Result<String, String> {
        let session = self.session.lock();
        match session.as_ref() {
            Some(user) => Ok(user.get("username").and_then(Value::as_str).unwrap_or("Admin").to_string()),
            None => Err("Authentication required".into()),
        }
    }

    pub fn user_id(&self) -> Result<i64, String> {
        let session = self.session.lock();
        session
            .as_ref()
            .and_then(|user| user.get("id").and_then(Value::as_i64))
            .ok_or_else(|| "Authentication required".to_string())
    }
}

/// `friendlyError` from ipc-handlers.js: the renderer only ever receives a
/// message string, so the exact Electron wording is preserved here.
pub fn friendly(error: impl Into<AppErrorBox>) -> String {
    error.into().0.message
}

/// Wrapper so `friendly` can accept `AppError` and rusqlite errors alike.
pub struct AppErrorBox(pub crate::error::AppError);

impl From<crate::error::AppError> for AppErrorBox {
    fn from(value: crate::error::AppError) -> Self {
        Self(value)
    }
}

impl From<rusqlite::Error> for AppErrorBox {
    fn from(value: rusqlite::Error) -> Self {
        Self(crate::error::AppError::from(value))
    }
}

impl From<String> for AppErrorBox {
    fn from(value: String) -> Self {
        Self(crate::error::AppError::new(value))
    }
}

impl From<&str> for AppErrorBox {
    fn from(value: &str) -> Self {
        Self(crate::error::AppError::new(value))
    }
}

/// Standard command result type: the payload, or a friendly message string
/// (the renderer's `catch (error)` reads it exactly like Electron's error).
pub type CmdResult = Result<Value, String>;

/// Runs a fallible closure through the friendly-error mapping.
// Retained for future command authors; commands map errors inline today.
#[allow(dead_code)]
pub fn run<T, E>(task: impl FnOnce() -> Result<T, E>) -> CmdResult
where
    E: Into<AppErrorBox>,
    T: Into<Value>,
{
    task().map(|value| value.into()).map_err(friendly)
}

/// Shorthand for command bodies that already produce `Value`s.
pub fn run_value(task: impl FnOnce() -> crate::error::AppResult<Value>) -> CmdResult {
    task().map_err(friendly)
}
