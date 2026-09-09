//! `auth:*` channels — login gate, recovery (available pre-auth), remembered
//! credentials, and the signed-in user's own account management.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn auth_login(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    run_value(move || {
        let payload = payload.unwrap_or(json!({}));
        let username = payload.get("username").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let password = payload.get("password").and_then(Value::as_str).unwrap_or("").to_string();
        if username.is_empty() || password.is_empty() {
            return Err(crate::error::AppError::new("Username and password are required"));
        }
        let user = state.database.authenticate(&username, &password)?;
        let Some(mut user) = user else {
            return Err(crate::error::AppError::new("Wrong username or password"));
        };
        // Never let the hash cross the bridge.
        if let Value::Object(map) = &mut user {
            map.remove("password");
        }
        *state.session.lock() = Some(user.clone());
        state.database.audit(
            user.get("username").and_then(Value::as_str).unwrap_or("Admin"),
            "LOGIN",
            "Session",
            "Signed in",
        );
        Ok(user)
    })
}

#[tauri::command]
pub async fn auth_status(state: State<'_, AppState>) -> CmdResult {
    let session = state.session.lock().clone();
    Ok(json!({ "authenticated": session.is_some(), "user": session }))
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> CmdResult {
    let actor = {
        let session = state.session.lock();
        session.as_ref().map(|user| user.get("username").and_then(Value::as_str).unwrap_or("Admin").to_string())
    };
    if let Some(actor) = actor {
        state.database.audit(&actor, "LOGOUT", "Session", "Signed out");
    }
    *state.session.lock() = None;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn auth_update_credentials(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let user_id = state.user_id()?;
    run_value(move || {
        let payload = payload.unwrap_or(json!({}));
        let result = state.database.update_credentials(user_id, &payload)?;
        state.database.audit(&actor, "ACCOUNT_UPDATE", "Account", "Credentials updated");
        Ok(result)
    })
}

#[tauri::command]
pub async fn auth_change_password(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let user_id = state.user_id()?;
    run_value(move || {
        let payload = payload.unwrap_or(json!({}));
        let current = payload.get("currentPassword").and_then(Value::as_str).unwrap_or("");
        let next = payload.get("newPassword").and_then(Value::as_str).unwrap_or("");
        // Re-authenticate with the current password before applying the change.
        let username = {
            let session = state.session.lock();
            session
                .as_ref()
                .map(|user| user.get("username").and_then(Value::as_str).unwrap_or("").to_string())
                .unwrap_or_default()
        };
        let ok = state.database.authenticate(&username, current)?.is_some();
        if !ok {
            return Err(crate::error::AppError::new("The current password is not correct"));
        }
        let result = state.database.update_credentials(user_id, &json!({ "password": next }))?;
        state.database.audit(&actor, "PASSWORD_CHANGE", "Account", "Password changed");
        state.database.sync_recovery_file();
        Ok(result)
    })
}

#[tauri::command]
pub async fn auth_recover_status(state: State<'_, AppState>) -> CmdResult {
    run_value(move || Ok(state.database.recovery_status()))
}

#[tauri::command]
pub async fn auth_recover(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    run_value(move || {
        let pin = payload
            .as_ref()
            .and_then(|payload| payload.get("pin"))
            .and_then(Value::as_str)
            .unwrap_or("");
        state.database.verify_recovery_pin(pin)
    })
}

#[tauri::command]
pub async fn auth_set_recovery_pin(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let user_id = state.user_id()?;
    run_value(move || {
        let pin = payload
            .as_ref()
            .and_then(|payload| payload.get("pin"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let result = state.database.set_recovery_pin(user_id, pin)?;
        state.database.audit(&actor, "RECOVERY_PIN_SET", "Recovery", "Recovery PIN updated");
        Ok(result)
    })
}

#[tauri::command]
pub async fn auth_remember_credentials(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    run_value(move || Ok(state.database.save_remembered_credentials(&payload.unwrap_or(json!({})))))
}

#[tauri::command]
pub async fn auth_remembered_credentials(state: State<'_, AppState>) -> CmdResult {
    run_value(move || Ok(state.database.get_remembered_credentials()))
}
