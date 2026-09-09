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
use services::update::UpdateService;
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
                        .and_then(|settings| settings.get("store_program_name").and_then(Value::as_str).unwrap_or("").to_string())
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

            // --- main window: hidden until first paint finishes ----------------
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_page_load(move |_window, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Ended {
                        let _ = window_clone.show();
                        let _ = window_clone.set_focus();
                    }
                });
                // Safety net: never leave the operator staring at nothing.
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
        .invoke_handler(tauri::generate_handler![
            commands::auth::login,
            commands::auth::status,
            commands::auth::logout,
            commands::auth::update_credentials,
            commands::auth::change_password,
            commands::auth::recover_status,
            commands::auth::recover,
            commands::auth::set_recovery_pin,
            commands::auth::remember_credentials,
            commands::auth::remembered_credentials,
            commands::branches::list,
            commands::branches::save,
            commands::branches::remove,
            commands::branches::remove_all,
            commands::devices::list,
            commands::devices::save,
            commands::devices::remove,
            commands::monitor::snapshot,
            commands::settings::get,
            commands::settings::save,
            commands::credentials::list,
            commands::credentials::reveal,
            commands::credentials::save,
            commands::credentials::remove,
            commands::credentials::mappings,
            commands::credentials::credential_map,
            commands::credentials::for_device,
            commands::credentials::save_mappings,
            commands::credentials::assign_device,
            commands::credentials::assign_type,
            commands::credentials::overview,
            commands::inventory::list,
            commands::inventory::export,
            commands::directory::template,
            commands::directory::import,
            commands::remote_cmd::connect,
            commands::remote_cmd::probe,
            commands::app_cmd::palette,
            commands::terminal_cmd::targets,
            commands::terminal_cmd::open,
            commands::terminal_cmd::write,
            commands::terminal_cmd::resize,
            commands::terminal_cmd::close,
            commands::snippets::list,
            commands::snippets::save,
            commands::snippets::remove,
            commands::notes::list,
            commands::notes::save,
            commands::notes::remove,
            commands::vpn_cmd::status,
            commands::vpn_cmd::probe,
            commands::vpn_cmd::connect,
            commands::vpn_cmd::disconnect,
            commands::vpn_cmd::diagnose,
            commands::update_cmd::check,
            commands::update_cmd::state_of,
            commands::update_cmd::download,
            commands::update_cmd::pause,
            commands::update_cmd::resume,
            commands::update_cmd::stop,
            commands::update_cmd::install,
            commands::audit::list,
            commands::dialog::select_file,
            commands::dialog::select_files,
            commands::dialog::select_directory,
            commands::app_cmd::info,
            commands::app_cmd::open_external,
            commands::app_cmd::path_exists,
            commands::store_update_cmd::import_agent,
            commands::store_update_cmd::import_agent_all,
            commands::store_update_cmd::version,
            commands::store_update_cmd::installed,
            commands::store_update_cmd::versions,
            commands::store_update_cmd::test_access,
            commands::store_update_cmd::deploy,
            commands::store_update_cmd::deploy_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HyperFamily Branch Monitor");
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
                    std::time::Duration::from_secs_f64((interval.max(1.0)) as f64)
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

