//! Service layer ports of electron/services/*.js.

pub mod agent_control;
pub mod agent_transfer;
pub mod device_webview;
pub mod excel;
pub mod ping;
pub mod portal;
pub mod reachability;
pub mod registry;
pub mod remote;
pub mod smb;
pub mod software;
pub mod store_agent;
pub mod store_update;
pub mod terminal;
pub mod updater;
pub mod vault;
pub mod vpn;

use serde_json::Value;

/// Every service reports progress through one of these. `Arc + Send + Sync`
/// because progress often crosses into blocking worker threads.
pub type Emitter = std::sync::Arc<dyn Fn(&str, Value) + Send + Sync>;
