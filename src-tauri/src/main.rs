//! Windows entry point. The window itself is created from tauri.conf.json
//! (hidden, then shown after the first page load — see lib.rs).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hyperfamily_branch_monitor::run();
}
