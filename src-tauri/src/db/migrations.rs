//! Port of electron/database/migrations.js — the same DDL, upgrade ALTERs,
//! triggers, default settings, seed snippets and user_version = 7.

use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use serde_json::json;

fn has_column(connection: &Connection, table: &str, column: &str) -> bool {
    let mut stmt = match connection.prepare(&format!("PRAGMA table_info({table})")) {
        Ok(stmt) => stmt,
        Err(_) => return false,
    };
    let rows = stmt.query_map([], |row| row.get::<_, String>(1));
    match rows {
        Ok(rows) => rows.flatten().any(|name| name == column),
        Err(_) => false,
    }
}

pub fn run_migrations(connection: &Connection, admin_hash: &str, admin_recovery: &str) -> AppResult<()> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;

             CREATE TABLE IF NOT EXISTS users (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               username TEXT UNIQUE NOT NULL COLLATE NOCASE,
               password TEXT NOT NULL,
               created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
               updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );

             CREATE TABLE IF NOT EXISTS branches (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT NOT NULL,
               code TEXT UNIQUE NOT NULL COLLATE NOCASE,
               warehouse_code TEXT NOT NULL,
               link1 TEXT,
               ip_link1 TEXT,
               link2 TEXT,
               ip_link2 TEXT,
               manager_name TEXT,
               manager_tell TEXT,
               deputy_name TEXT,
               deputy_tell TEXT,
               created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
               updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );

             CREATE TABLE IF NOT EXISTS devices (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               branch_id INTEGER NOT NULL,
               device_type TEXT NOT NULL CHECK (device_type IN ('Router','Switch','iLO','Server','NVR','AccessPoint','Scale','Client','Checkout','POS')),
               model TEXT,
               name TEXT NOT NULL,
               location TEXT,
               ip TEXT NOT NULL,
               port INTEGER CHECK (port IS NULL OR (port BETWEEN 1 AND 65535)),
               asset_code TEXT,
               connection_type TEXT,
               transport TEXT CHECK (transport IS NULL OR transport IN ('ssh','telnet')),
               connection_port TEXT,
               hostname TEXT,
               user TEXT,
               domain TEXT,
               esxi_version TEXT,
               version TEXT,
               terminal_id TEXT,
               acceptance_id TEXT,
               brand TEXT,
               checkout_number INTEGER,
               serial_number TEXT,
               remote_id TEXT,
               protocol TEXT DEFAULT 'https' CHECK (protocol IN ('http','https')),
               is_dashboard_visible INTEGER NOT NULL DEFAULT 0 CHECK (is_dashboard_visible IN (0,1)),
               created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
               updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
               FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS switch_ports (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               device_id INTEGER NOT NULL,
               port_number INTEGER NOT NULL CHECK (port_number BETWEEN 1 AND 48),
               vlan TEXT,
               status TEXT NOT NULL DEFAULT 'up' CHECK (status IN ('up','down','disabled')),
               ip TEXT,
               details TEXT,
               created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
               updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
               FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
               UNIQUE (device_id, port_number)
             );

             CREATE TABLE IF NOT EXISTS credentials (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT UNIQUE NOT NULL COLLATE NOCASE,
               username TEXT NOT NULL,
               password TEXT NOT NULL,
               created_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );

             CREATE TABLE IF NOT EXISTS device_credentials (
               device_type TEXT NOT NULL,
               credential_id INTEGER NOT NULL,
               PRIMARY KEY (device_type, credential_id),
               FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS device_credential_assignments (
               device_id INTEGER NOT NULL,
               credential_id INTEGER NOT NULL,
               PRIMARY KEY (device_id, credential_id),
               FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
               FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS ping_history (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               device_id INTEGER NOT NULL,
               ping_time INTEGER,
               status TEXT NOT NULL CHECK (status IN ('online','warning','offline')),
               timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
               FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS uptime_logs (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               device_id INTEGER NOT NULL,
               uptime_percent REAL NOT NULL DEFAULT 0,
               total_checks INTEGER NOT NULL DEFAULT 0,
               successful_checks INTEGER NOT NULL DEFAULT 0,
               date DATE NOT NULL,
               FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
               UNIQUE (device_id, date)
             );

             CREATE TABLE IF NOT EXISTS settings (
               key TEXT PRIMARY KEY,
               value TEXT,
               updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );

             CREATE TABLE IF NOT EXISTS audit_logs (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               user TEXT NOT NULL,
               action TEXT NOT NULL,
               target TEXT,
               details TEXT,
               timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
             );

             CREATE INDEX IF NOT EXISTS idx_devices_branch ON devices(branch_id);
             CREATE INDEX IF NOT EXISTS idx_devices_type ON devices(device_type);
             CREATE INDEX IF NOT EXISTS idx_switch_ports_device ON switch_ports(device_id);
             CREATE INDEX IF NOT EXISTS idx_ping_device ON ping_history(device_id);
             CREATE INDEX IF NOT EXISTS idx_ping_timestamp ON ping_history(timestamp);
             CREATE INDEX IF NOT EXISTS idx_uptime_device ON uptime_logs(device_id);
             CREATE INDEX IF NOT EXISTS idx_uptime_date ON uptime_logs(date);
             CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
             CREATE INDEX IF NOT EXISTS idx_device_credentials_credential ON device_credentials(credential_id);
             CREATE INDEX IF NOT EXISTS idx_device_credential_assignments_credential ON device_credential_assignments(credential_id);

             CREATE TRIGGER IF NOT EXISTS validate_switch_port_number_insert
             BEFORE INSERT ON switch_ports
             WHEN NEW.port_number < 1 OR NEW.port_number > 48
             BEGIN
               SELECT RAISE(ABORT, 'Switch Port Number must be from 1 through 48');
             END;

             CREATE TRIGGER IF NOT EXISTS validate_switch_port_number_update
             BEFORE UPDATE OF port_number ON switch_ports
             WHEN NEW.port_number < 1 OR NEW.port_number > 48
             BEGIN
               SELECT RAISE(ABORT, 'Switch Port Number must be from 1 through 48');
             END;

             CREATE TRIGGER IF NOT EXISTS validate_switch_port_count_insert
             BEFORE INSERT ON switch_ports
             WHEN (SELECT COUNT(*) FROM switch_ports WHERE device_id = NEW.device_id) >= 48
             BEGIN
               SELECT RAISE(ABORT, 'A Switch can contain at most 48 ports');
             END;

             CREATE TRIGGER IF NOT EXISTS validate_switch_port_count_device_update
             BEFORE UPDATE OF device_id ON switch_ports
             WHEN NEW.device_id <> OLD.device_id
               AND (SELECT COUNT(*) FROM switch_ports WHERE device_id = NEW.device_id) >= 48
             BEGIN
               SELECT RAISE(ABORT, 'A Switch can contain at most 48 ports');
             END;
            ",
        )
        .map_err(AppError::from)?;

    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT NOT NULL,
               body TEXT NOT NULL DEFAULT '',
               pinned INTEGER NOT NULL DEFAULT 0,
               color TEXT NOT NULL DEFAULT 'default',
               priority INTEGER NOT NULL DEFAULT 0,
               created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
               updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );

             CREATE TABLE IF NOT EXISTS terminal_snippets (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT NOT NULL,
               command TEXT NOT NULL,
               description TEXT,
               created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
               updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );

             CREATE INDEX IF NOT EXISTS idx_terminal_snippets_name ON terminal_snippets(name COLLATE NOCASE);
            ",
        )
        .map_err(AppError::from)?;

    // Upgrade paths for databases made by early builds (kept verbatim so a
    // database created by the Electron app remains compatible).
    if !has_column(connection, "devices", "remote_id") {
        connection.execute_batch("ALTER TABLE devices ADD COLUMN remote_id TEXT")?;
    }
    if !has_column(connection, "devices", "transport") {
        connection.execute_batch("ALTER TABLE devices ADD COLUMN transport TEXT")?;
    }
    if !has_column(connection, "devices", "protocol") {
        connection.execute_batch("ALTER TABLE devices ADD COLUMN protocol TEXT DEFAULT 'https'")?;
    }
    if !has_column(connection, "devices", "serial_number") {
        connection.execute_batch("ALTER TABLE devices ADD COLUMN serial_number TEXT")?;
    }
    if !has_column(connection, "branches", "warehouse_code") {
        connection.execute_batch("ALTER TABLE branches ADD COLUMN warehouse_code TEXT")?;
    }
    if !has_column(connection, "notes", "color") {
        connection.execute_batch("ALTER TABLE notes ADD COLUMN color TEXT NOT NULL DEFAULT 'default'")?;
    }
    if !has_column(connection, "notes", "priority") {
        connection.execute_batch("ALTER TABLE notes ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")?;
    }
    if !has_column(connection, "notes", "tags") {
        connection.execute_batch("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")?;
    }
    if !has_column(connection, "users", "password_recovery") {
        connection.execute_batch("ALTER TABLE users ADD COLUMN password_recovery TEXT NOT NULL DEFAULT ''")?;
    }
    if !has_column(connection, "users", "recovery_pin_hash") {
        connection.execute_batch("ALTER TABLE users ADD COLUMN recovery_pin_hash TEXT NOT NULL DEFAULT ''")?;
    }
    connection.execute_batch("DROP INDEX IF EXISTS idx_notes_updated")?;
    connection.execute_batch("CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(pinned DESC, priority DESC, updated_at DESC)")?;
    connection.execute_batch(
        "UPDATE branches
         SET warehouse_code = 'LEGACY-' || code
         WHERE warehouse_code IS NULL OR trim(warehouse_code) = '';
         UPDATE devices
         SET name = device_type || ' ' || id
         WHERE name IS NULL OR trim(name) = '';
         CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_warehouse_code_unique
           ON branches(warehouse_code COLLATE NOCASE)
           WHERE warehouse_code IS NOT NULL AND trim(warehouse_code) <> '';",
    )?;

    let duplicate_router_branches: i64 = connection.query_row(
        "SELECT COUNT(*) AS count FROM (
           SELECT branch_id FROM devices WHERE device_type = 'Router' GROUP BY branch_id HAVING COUNT(*) > 1
         )",
        [],
        |row| row.get(0),
    )?;
    if duplicate_router_branches == 0 {
        connection.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_one_router_per_branch ON devices(branch_id) WHERE device_type = 'Router'",
        )?;
    }

    let user_count: i64 = connection.query_row("SELECT COUNT(*) AS count FROM users", [], |row| row.get(0))?;
    if user_count == 0 {
        connection.execute(
            "INSERT INTO users (username, password, password_recovery) VALUES ('Admin', ?1, ?2)",
            rusqlite::params![admin_hash, admin_recovery],
        )?;
    }

    let defaults = json!({
        "theme": "aurora", "theme_custom": "", "ping_interval": 3, "ping_history_count": 30,
        "dashboard_branch_mode": "compact_over_four", "dashboard_branch_details_view": "modal",
        "teamviewer_path": "C:\\Program Files\\TeamViewer\\TeamViewer.exe", "teamviewer_password": "",
        "winbox_path": "C:\\Program Files\\Winbox\\winbox64.exe", "winbox_port": 8291,
        "teamviewer_lan_mode": true,
        "vpn_gateway": "", "vpn_port": 443, "vpn_user": "", "vpn_pass": "", "vpn_autoconnect": false,
        "forticlient_path": "C:\\Program Files\\Fortinet\\FortiClient\\FortiClient.exe",
        "terminal_font_size": 14, "terminal_ssh_port": 22, "terminal_telnet_port": 23,
        "terminal_font_family": "ui-monospace", "terminal_syntax_highlight": true,
        "webview_autologin": true,
        "font_header_family": "", "font_header_size": 100,
        "font_title_family": "", "font_title_size": 100,
        "font_text_family": "", "font_text_size": 100,
        "font_info_family": "", "font_info_size": 100,
        "font_mono_family": "", "font_mono_size": 100
    });
    let mut insert = connection.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)")?;
    if let serde_json::Value::Object(entries) = &defaults {
        for (key, value) in entries {
            insert.execute(rusqlite::params![key, value.to_string()])?;
        }
    }

    connection.execute_batch("DELETE FROM settings WHERE key LIKE 'guacamole_%'")?;
    connection.execute_batch("DELETE FROM settings WHERE key IN ('vpn_realm', 'vpn_mode')")?;

    let snippet_count: i64 = connection.query_row("SELECT COUNT(*) AS count FROM terminal_snippets", [], |row| row.get(0))?;
    if snippet_count == 0 {
        let mut insert = connection.prepare("INSERT INTO terminal_snippets (name, command, description) VALUES (?1, ?2, ?3)")?;
        for (name, command, description) in [
            ("Show interfaces", "show interfaces status", "Port status overview"),
            ("Show VLANs", "show vlan brief", "Configured VLANs and member ports"),
            ("Show MAC table", "show mac address-table", "Learned MAC addresses"),
            ("Show running config", "show running-config", "Active configuration"),
            ("Save config", "write memory", "Persist the running configuration"),
            ("Show uptime", "show version | include uptime", "Device uptime"),
        ] {
            insert.execute(rusqlite::params![name, command, description])?;
        }
    }

    connection.execute_batch("PRAGMA user_version = 7")?;
    Ok(())
}
