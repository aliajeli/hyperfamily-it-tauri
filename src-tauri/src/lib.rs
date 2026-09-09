//! Application assembly: plugins, the shared state, the two background loops
//! (ping monitor and VPN health), and every IPC channel wired 1:1 to the
//! Electron channel names.

mod commands;
mod db;
mod error;
mod services;

use commands::AppState;
use services::smb::SmbSessionManager;
use services::store_agent::StoreAgentService;
use services::store_update::StoreUpdateService;
use services::terminal::TerminalService;
use services::updater::UpdateService;
use services::vault::SecureVault;
use services::vpn::VpnService;
use serde_json::Value;
use std::sync::Arc;
use tauri::{Emitter as _, Manager};

/// Entry point used by main.rs.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: bring the running window back instead.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // --- data + crypto ------------------------------------------------
            let user_data = app.path().app_data_dir()?;
            let vault = Arc::new(SecureVault::new(&user_data));
            let database = Arc::new(db::AppDatabase::open(
                &user_data,
                vault.clone(),
                Some(user_data.join("credentials.dat")),
            )?);

            // --- progress emitter: Rust closures → webview events -------------
            let handle = app.handle().clone();
            let emitter: services::Emitter = Arc::new(move |channel: &str, payload: Value| {
                let _ = handle.emit(channel, payload);
            });

            // --- services ------------------------------------------------------
            let smb = Arc::new(SmbSessionManager::new());
            let get_credentials = {
                let database = database.clone();
                Box::new(move || {
                    let settings = database.get_settings().unwrap_or(Value::Null);
                    SmbSessionManager::credentials_from(&settings)
                })
            };
            let get_program_name = {
                let database = database.clone();
                Box::new(move || {
                    database
                        .get_settings()
                        .ok()
                        .map(|settings| settings.get("store_program_name").and_then(Value::as_str).unwrap_or("").to_string())
                        .unwrap_or_default()
                })
            };
            let store_agent = Arc::new(StoreAgentService::new(
                user_data.join("agent-downloads"),
                smb.clone(),
                {
                    let database = database.clone();
                    Box::new(move || {
                        database
                            .get_settings()
                            .map(|settings| settings.get("store_program_name").cloned().unwrap_or(Value::Null))
                            .unwrap_or(Value::Null)
                    })
                },
            ));
            let store_update = Arc::new(StoreUpdateService::new(smb.clone(), store_agent.clone(), get_credentials, get_program_name));
            let vpn = Arc::new(VpnService::new(database.clone(), emitter.clone()));
            let terminal = Arc::new(TerminalService::new(database.clone(), emitter.clone()));
            let update = Arc::new(UpdateService::new(app.handle().clone(), emitter.clone()));

            app.manage(AppState {
                database,
                vault,
                smb: smb.clone(),
                store_update,
                store_agent,
                vpn: vpn.clone(),
                terminal,
                update,
                emitter: emitter.clone(),
                session: parking_lot::Mutex::new(None),
                update_cancel: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            });

            // --- background loops ----------------------------------------------
            start_ping_loop(app.handle().clone(), emitter.clone());
            start_vpn_health_loop(vpn);

            // Safety net: never leave the operator staring at nothing.
            if let Some(window) = app.get_webview_window("main") {
                let fallback = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(6));
                    if !fallback.is_visible().unwrap_or(true) {
                        let _ = fallback.show();
                        let _ = fallback.set_focus();
                    }
                });
            }

            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished && webview.label() == "main" {
                let window = webview.window();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::auth_login,
            commands::auth::auth_status,
            commands::auth::auth_logout,
            commands::auth::auth_update_credentials,
            commands::auth::auth_change_password,
            commands::auth::auth_recover_status,
            commands::auth::auth_recover,
            commands::auth::auth_set_recovery_pin,
            commands::auth::auth_remember_credentials,
            commands::auth::auth_remembered_credentials,
            commands::branches::branches_list,
            commands::branches::branches_save,
            commands::branches::branches_remove,
            commands::branches::branches_remove_all,
            commands::devices::devices_list,
            commands::devices::devices_save,
            commands::devices::devices_remove,
            commands::monitor::monitor_snapshot,
            commands::settings::settings_get,
            commands::settings::settings_save,
            commands::credentials::credentials_list,
            commands::credentials::credentials_reveal,
            commands::credentials::credentials_save,
            commands::credentials::credentials_remove,
            commands::credentials::credentials_mappings,
            commands::credentials::credentials_credential_map,
            commands::credentials::credentials_for_device,
            commands::credentials::credentials_save_mappings,
            commands::credentials::credentials_assign_device,
            commands::credentials::credentials_assign_type,
            commands::credentials::credentials_overview,
            commands::inventory::inventory_list,
            commands::inventory::inventory_export,
            commands::directory::directory_template,
            commands::directory::directory_import,
            commands::remote_cmd::remote_connect,
            commands::remote_cmd::remote_probe,
            commands::app_cmd::app_info,
            commands::app_cmd::app_open_external,
            commands::app_cmd::app_path_exists,
            commands::app_cmd::remote_palette,
            commands::terminal_cmd::terminal_targets,
            commands::terminal_cmd::terminal_open,
            commands::terminal_cmd::terminal_write,
            commands::terminal_cmd::terminal_resize,
            commands::terminal_cmd::terminal_close,
            commands::snippets::snippets_list,
            commands::snippets::snippets_save,
            commands::snippets::snippets_remove,
            commands::notes::notes_list,
            commands::notes::notes_save,
            commands::notes::notes_remove,
            commands::vpn_cmd::vpn_status,
            commands::vpn_cmd::vpn_probe,
            commands::vpn_cmd::vpn_connect,
            commands::vpn_cmd::vpn_disconnect,
            commands::vpn_cmd::vpn_diagnose,
            commands::update_cmd::update_check,
            commands::update_cmd::update_state,
            commands::update_cmd::update_download,
            commands::update_cmd::update_pause,
            commands::update_cmd::update_resume,
            commands::update_cmd::update_stop,
            commands::update_cmd::update_install,
            commands::audit::audit_list,
            commands::dialog::dialog_select_file,
            commands::dialog::dialog_select_files,
            commands::dialog::dialog_select_directory,
            commands::store_update_cmd::store_update_import_agent,
            commands::store_update_cmd::store_update_import_agent_all,
            commands::store_update_cmd::store_update_version,
            commands::store_update_cmd::store_update_installed,
            commands::store_update_cmd::store_update_versions,
            commands::store_update_cmd::store_update_test_access,
            commands::store_update_cmd::store_update_deploy,
            commands::store_update_cmd::store_update_deploy_all,
        ])
        .build(tauri::generate_context!())
        .expect("error while building HyperFamily Branch Monitor")
        .run(|app, event| {
            // Electron's before-quit: close every terminal session gracefully.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.terminal.stop();
                }
            }
        });
}

/// Port of PingMonitor: first pass after 250 ms, then one pass every
/// `ping_interval` seconds (5 s retry on failure) emitting `monitor:update`.
fn start_ping_loop(app: tauri::AppHandle, emitter: services::Emitter) {
    tauri::async_runtime::spawn(async move {
        let database = match app.try_state::<AppState>() {
            Some(state) => state.database.clone(),
            None => return,
        };
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        loop {
            let delay = match services::ping::monitor_tick(&database, &emitter).await {
                Ok(()) => {
                    let settings = database.get_settings().unwrap_or(Value::Null);
                    let interval = settings.get("ping_interval").and_then(Value::as_f64).unwrap_or(3.0);
                    std::time::Duration::from_secs_f64((interval.max(1.0)))
                }
                Err(error) => {
                    database.audit("System", "PING_SERVICE_ERROR", "Monitoring", &error.message);
                    std::time::Duration::from_secs(5)
                }
            };
            tokio::time::sleep(delay).await;
        }
    });
}

/// Port of the VPN health poll: one probe per second while a session is
/// active; status changes (tunnel dropped/adopted) broadcast immediately.
fn start_vpn_health_loop(vpn: Arc<VpnService>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            vpn.health_tick().await;
        }
    });
}

