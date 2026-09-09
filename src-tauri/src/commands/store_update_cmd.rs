//! `store-update:*` — Store Commerce version sweeps, target-access test,
//! agent imports, and the single/all deployment pipelines.

use super::{run_value, AppState, CmdResult};
use serde_json::{json, Value};
use tauri::State;

fn checkout_of(payload: &Option<Value>) -> Value {
    payload
        .as_ref()
        .and_then(|payload| payload.get("checkout"))
        .cloned()
        .unwrap_or(json!({}))
}

fn audit_result(state: &AppState, actor: &str, result: &Value) {
    let target = result
        .get("name")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .or_else(|| result.get("host").and_then(Value::as_str))
        .unwrap_or("checkout");
    let details = if result.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        format!(
            "SHA-256 {}; copied={}; service running",
            result.get("sha256").and_then(Value::as_str).unwrap_or("—"),
            result.get("copied").and_then(Value::as_i64).unwrap_or(0)
        )
    } else {
        result.get("error").and_then(Value::as_str).unwrap_or("Unknown failure").to_string()
    };
    state.database.audit(actor, "AGENT_IMPORT", target, &details);
}

#[tauri::command]
pub async fn store_update_import_agent(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let checkout = checkout_of(&payload);
    let emitter = Some(state.emitter.clone());
    run_value(move || {
        let result = futures_now(state.store_agent.import_one(&checkout, &emitter));
        audit_result(&state, &actor, &result);
        Ok(result)
    })
}

#[tauri::command]
pub async fn store_update_import_agent_all(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let checkouts: Vec<Value> = payload
        .as_ref()
        .and_then(|payload| payload.get("checkouts"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let emitter = Some(state.emitter.clone());
    run_value(move || {
        if checkouts.len() > 2000 {
            return Err(crate::error::AppError::new("At most 2000 checkouts can be imported in one run"));
        }
        let summary = futures_now(state.store_agent.import_all(&checkouts, &emitter));
        if let Some(results) = summary.get("results").and_then(Value::as_array).cloned() {
            for result in &results {
                audit_result(&state, &actor, result);
            }
        }
        Ok(summary)
    })
}

#[tauri::command]
pub async fn store_update_version(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let _ = state.actor()?;
    let checkout = checkout_of(&payload);
    run_value(move || Ok(futures_now(state.store_update.check_one(&checkout))))
}

#[tauri::command]
pub async fn store_update_installed(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let checkout = checkout_of(&payload);
    run_value(move || {
        let result = futures_now(state.store_update.list_installed_on(&checkout))?;
        let label = result.get("label").and_then(Value::as_str).unwrap_or("checkout").to_string();
        let total = result.get("total").and_then(Value::as_i64).unwrap_or(0);
        let source = result.get("source").and_then(Value::as_str).unwrap_or("agent").to_string();
        state.database.audit(&actor, "STORE_LIST_INSTALLED", &label, &format!("{total} program(s) read from {source}"));
        Ok(result)
    })
}

#[tauri::command]
pub async fn store_update_versions(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let checkouts: Vec<Value> = payload
        .as_ref()
        .and_then(|payload| payload.get("checkouts"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let emitter = Some(state.emitter.clone());
    run_value(move || {
        let results = futures_now(state.store_update.check_many(&checkouts, &emitter));
        state.database.audit(
            &actor,
            "STORE_VERSION_SWEEP",
            &format!("{} checkout(s)", results.len()),
            &format!("Program: {} (read by local agent from Programs and Features)", state.store_update.program_name()),
        );
        Ok(Value::Array(results))
    })
}

#[tauri::command]
pub async fn store_update_test_access(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let payload = payload.unwrap_or(json!({}));
    run_value(move || {
        let settings = state.database.get_settings()?;
        let host = payload.get("host").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if host.is_empty() {
            return Err(crate::error::AppError::new("Enter the hostname or IP of a checkout to test against"));
        }
        let field = |key: &str, fallback: &str| -> String {
            payload
                .get(key)
                .map(|value| match value {
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                })
                .unwrap_or_else(|| fallback.to_string())
                .trim()
                .to_string()
        };
        let credentials = json!({
            "domain": field("domain", settings.get("target_domain").and_then(Value::as_str).unwrap_or("")),
            "username": field("username", settings.get("target_admin_user").and_then(Value::as_str).unwrap_or("")),
            "password": if payload.get("password").map(|value| !value.is_null()).unwrap_or(false) {
                payload.get("password").and_then(Value::as_str).unwrap_or("").to_string()
            } else {
                settings.get("target_admin_password").and_then(Value::as_str).unwrap_or("").to_string()
            }
        });
        let result = futures_now(state.smb.test(&host, &credentials))?;
        state.database.audit(
            &actor,
            "TARGET_ACCESS_TEST",
            &host,
            &format!("Signed in as {} in {} ms", result.get("user").and_then(Value::as_str).unwrap_or(""), result.get("durationMs").and_then(Value::as_i64).unwrap_or(0)),
        );
        Ok(result)
    })
}

#[tauri::command]
pub async fn store_update_deploy(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let payload = payload.unwrap_or(json!({}));
    let checkout = checkout_of(&Some(payload.clone()));
    let source = payload.get("source").and_then(Value::as_str).unwrap_or("").to_string();
    let destination_path = payload.get("destinationPath").and_then(Value::as_str).unwrap_or("").to_string();
    let run_id = payload
        .get("runId")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(|| format!("single-{}", chrono::Utc::now().timestamp_millis()));
    let stamp = payload.get("stamp").and_then(Value::as_str).map(String::from);
    let emitter = Some(state.emitter.clone());
    run_value(move || {
        let result = futures_now(state.store_update.deploy_one(&checkout, &source, &destination_path, &run_id, stamp, &emitter));
        let label = checkout
            .get("name")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .or_else(|| checkout.get("hostname").and_then(Value::as_str))
            .unwrap_or("checkout");
        let ok = result.get("ok").and_then(Value::as_bool).unwrap_or(false);
        let mut details = if ok {
            format!(
                "Deployed {} bytes in {} ms",
                result.get("bytes").and_then(Value::as_i64).unwrap_or(0),
                result.get("durationMs").and_then(Value::as_i64).unwrap_or(0)
            )
        } else {
            result.get("error").and_then(Value::as_str).unwrap_or("Deployment failed").to_string()
        };
        if let Some(backup) = result.get("backup").and_then(Value::as_str) {
            details.push_str(&format!("; backup: {backup}"));
        }
        state.database.audit(&actor, "STORE_DEPLOY_ONE", &format!("{label} — {}", if ok { "OK" } else { "FAILED" }), &details);
        // The Electron build never threw here: the renderer reads ok/error
        // off the returned summary, which carries the full step timeline.
        Ok(result)
    })
}

#[tauri::command]
pub async fn store_update_deploy_all(state: State<'_, AppState>, payload: Option<Value>) -> CmdResult {
    let actor = state.actor()?;
    let payload = payload.unwrap_or(json!({}));
    let checkouts: Vec<Value> = payload
        .get("checkouts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let source = payload.get("source").and_then(Value::as_str).unwrap_or("").to_string();
    let destination_path = payload.get("destinationPath").and_then(Value::as_str).unwrap_or("").to_string();
    let emitter = Some(state.emitter.clone());
    run_value(move || {
        let summary = futures_now(state.store_update.deploy_all(&checkouts, &source, &destination_path, &emitter));
        let file_name = source.rsplit(['\\', '/']).next().unwrap_or("—");
        state.database.audit(
            &actor,
            "STORE_DEPLOY_ALL",
            &format!("{}/{} checkout(s) updated", summary.get("ok").and_then(Value::as_i64).unwrap_or(0), summary.get("total").and_then(Value::as_i64).unwrap_or(0)),
            &format!("File: {file_name} → {destination_path} ({} ms)", summary.get("durationMs").and_then(Value::as_i64).unwrap_or(0)),
        );
        Ok(summary)
    })
}

/// Await an async service call from the sync command body.
fn futures_now<F: std::future::Future>(future: F) -> F::Output {
    tokio::task::block_in_place(|| tauri::async_runtime::block_on(future))
}
