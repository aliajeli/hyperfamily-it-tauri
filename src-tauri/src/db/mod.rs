//! Port of electron/database/index.js + migrations.js — the encrypted SQLite
//! layer. SQLCipher (same engine as better-sqlite3-multiple-ciphers in
//! `cipher='sqlcipher'` mode) protects the file; the hex key lives in a
//! DPAPI-protected `.database-key` file, exactly like the original build.

pub mod migrations;

use crate::error::{AppError, AppResult};
use crate::services::vault::{hash_pin, verify_pin_hash, SecureVault};
use rusqlite::{types::ValueRef, Connection, Row};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const DEVICE_COLUMNS: &[&str] = [
    "branch_id", "device_type", "model", "name", "location", "ip", "port", "asset_code",
    "connection_type", "transport", "connection_port", "hostname", "user", "domain", "esxi_version",
    "version", "terminal_id", "acceptance_id", "brand", "checkout_number", "serial_number",
    "remote_id", "protocol", "is_dashboard_visible",
]
.as_slice();

pub const BRANCH_COLUMNS: &[&str] = [
    "name", "code", "warehouse_code", "link1", "ip_link1", "link2", "ip_link2",
    "manager_name", "manager_tell", "deputy_name", "deputy_tell",
]
.as_slice();

pub const NOTE_COLORS: &[&str] = &["default", "red", "amber", "green", "blue", "purple"];
const SENSITIVE_SETTINGS: &[&str] = &["teamviewer_password", "vpn_pass", "target_admin_password"];
pub const MAX_SWITCH_PORTS: i64 = 48;

/// Converts one SQLite row into the JSON shape better-sqlite3 returned.
/// serde_json values are not rusqlite `ToSql` without the JSON feature;
/// normalise them into rusqlite's own dynamic value type instead.
fn json_to_sql(value: &Value) -> rusqlite::types::Value {
    match value {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(flag) => rusqlite::types::Value::Integer(i64::from(*flag)),
        Value::Number(number) => {
            if let Some(int) = number.as_i64() {
                rusqlite::types::Value::Integer(int)
            } else {
                rusqlite::types::Value::Real(number.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(text) => rusqlite::types::Value::Text(text.clone()),
        other => rusqlite::types::Value::Text(other.to_string()),
    }
}

pub fn row_to_json(row: &Row<'_>) -> rusqlite::Result<Value> {
    let columns: Vec<String> = row.as_ref().column_names().into_iter().map(String::from).collect();
    let mut map = Map::new();
    for (index, name) in columns.into_iter().enumerate() {
        let value = match row.get_ref(index)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(v) => json!(v),
            ValueRef::Real(v) => json!(v),
            ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
            ValueRef::Blob(v) => json!(String::from_utf8_lossy(v)),
        };
        map.insert(name, value);
    }
    Ok(Value::Object(map))
}

fn rows_to_json(stmt: &mut rusqlite::Statement<'_>) -> AppResult<Vec<Value>> {
    let rows = stmt.query_map([], row_to_json)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Accepts both `3` and `3.0` identifiers coming from the JS renderer.
pub fn as_id(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| value.as_i64().or_else(|| value.as_f64().map(|float| float as i64)))
}

fn audit_conn(connection: &Connection, user: &str, action: &str, target: &str, details: &str) {
    let _ = connection.execute(
        "INSERT INTO audit_logs (user, action, target, details) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![if user.is_empty() { "System" } else { user }, action, target, details],
    );
}

pub struct AppDatabase {
    pub connection: Mutex<Connection>,
    pub vault: std::sync::Arc<SecureVault>,
    pub file_path: PathBuf,
    pub user_data_path: PathBuf,
    pub recovery_file_path: Option<PathBuf>,
}

pub struct SessionUser {
    pub id: i64,
    pub username: String,
}

pub fn parse_tags(raw: Option<&str>) -> Vec<Value> {
    let Some(raw) = raw else { return vec![] };
    match serde_json::from_str::<Value>(raw) {
        Ok(value) => sanitise_tags(&value),
        Err(_) => vec![],
    }
}

pub fn sanitise_tags(value: &Value) -> Vec<Value> {
    let Value::Array(items) = value else { return vec![] };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items {
        let tag = match item.as_str() {
            Some(text) => text,
            None => continue,
        };
        let cleaned: String = tag
            .trim()
            .trim_start_matches('#')
            .chars()
            .take(40)
            .collect::<String>()
            .to_lowercase();
        if cleaned.is_empty() || !seen.insert(cleaned.clone()) {
            continue;
        }
        out.push(json!(cleaned));
        if out.len() >= 20 {
            break;
        }
    }
    out
}

pub fn normalize_switch_ports(ports: &Value) -> AppResult<Vec<Value>> {
    let Some(items) = ports.as_array() else {
        return Err(AppError::new("Switch ports must be provided as a list"));
    };
    if items.len() as i64 > MAX_SWITCH_PORTS {
        return Err(AppError::new(format!("A Switch can contain at most {MAX_SWITCH_PORTS} ports")));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (index, port) in items.iter().enumerate() {
        let number = port.get("port_number").and_then(Value::as_i64).unwrap_or(0);
        if !(1..=MAX_SWITCH_PORTS).contains(&number) {
            return Err(AppError::new(format!(
                "Switch port {} must use a Port Number from 1 through {MAX_SWITCH_PORTS}",
                index + 1
            )));
        }
        if !seen.insert(number) {
            return Err(AppError::new(format!("Switch Port Number {number} is duplicated")));
        }
        let mut entry = port.clone();
        if entry.get("port_number").is_none() {
            entry["port_number"] = json!(number);
        }
        out.push(entry);
    }
    Ok(out)
}

struct SavedRow {
    id: i64,
    name: String,
    summary: String,
    added: bool,
    value: Value,
}

fn branch_values(data: &Value) -> AppResult<(Vec<Option<String>>, String, String, String)> {
    let name = data.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let code = data.get("code").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let warehouse = data.get("warehouse_code").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if name.is_empty() || code.is_empty() {
        return Err(AppError::new("Branch name and code are required"));
    }
    if warehouse.is_empty() {
        return Err(AppError::new("Warehouse Code is required"));
    }
    let code_ok = code.len() <= 20 && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !code_ok {
        return Err(AppError::new("Branch Code must use no more than 20 letters, numbers, dashes, or underscores"));
    }
    let warehouse_ok = warehouse.len() <= 40 && warehouse.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !warehouse_ok {
        return Err(AppError::new("Warehouse Code must use no more than 40 letters, numbers, dashes, or underscores"));
    }
    let values = BRANCH_COLUMNS
        .iter()
        .map(|key| {
            let raw = data.get(*key).and_then(Value::as_str).unwrap_or("").trim().to_string();
            if raw.is_empty() { None } else { Some(raw) }
        })
        .collect();
    Ok((values, name, code, warehouse))
}

fn save_branch_conn(connection: &Connection, data: &Value) -> AppResult<SavedRow> {
    let (values, name, _code, _warehouse) = branch_values(data)?;
    let params: Vec<&dyn rusqlite::ToSql> = values.iter().map(|item| item as &dyn rusqlite::ToSql).collect();
    if let Some(id) = as_id(data.get("id")) {
        let assignments: Vec<String> = BRANCH_COLUMNS.iter().map(|key| format!("{key} = ?")).collect();
        let sql = format!(
            "UPDATE branches SET {}, updated_at = CURRENT_TIMESTAMP WHERE id = ?{}",
            assignments.join(", "),
            BRANCH_COLUMNS.len() + 1
        );
        let mut all: Vec<&dyn rusqlite::ToSql> = params.clone();
        all.push(&id);
        let changes = connection.execute(&sql, all.as_slice()).map_err(AppError::from)?;
        if changes == 0 {
            return Err(AppError::new("Branch not found"));
        }
        let mut value = data.clone();
        value["id"] = json!(id);
        return Ok(SavedRow { id, summary: name.clone(), name, added: false, value });
    }
    let sql = format!(
        "INSERT INTO branches ({}) VALUES ({})",
        BRANCH_COLUMNS.join(","),
        BRANCH_COLUMNS.iter().map(|_| "?".to_string()).collect::<Vec<_>>().join(",")
    );
    connection.execute(&sql, params.as_slice()).map_err(AppError::from)?;
    let id = connection.last_insert_rowid();
    let mut value = data.clone();
    value["id"] = json!(id);
    Ok(SavedRow { id, summary: name.clone(), name, added: true, value })
}

fn device_values(data: &Value) -> AppResult<(Vec<Value>, String, String, String)> {
    let mut normalized = data.clone();
    let branch_id = data
        .get("branch_id")
        .and_then(Value::as_f64)
        .map(|value| value as i64)
        .ok_or_else(|| AppError::new("A branch is required"))?;
    normalized["branch_id"] = json!(branch_id);
    let name = data.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Err(AppError::new("Device Name is required"));
    }
    normalized["name"] = json!(name);
    normalized["port"] = match data.get("port") {
        Some(Value::Number(_)) => json!(data.get("port").and_then(Value::as_f64).map(|value| value as i64)),
        Some(Value::String(text)) if !text.trim().is_empty() => {
            json!(Some(text.trim().parse::<i64>().map_err(|_| AppError::new("Port must be a whole number"))?))
        }
        _ => Value::Null,
    };
    let connection_port = data.get("connection_port").and_then(Value::as_str).unwrap_or("").trim().to_string();
    normalized["connection_port"] = if connection_port.is_empty() { Value::Null } else { json!(connection_port) };
    normalized["checkout_number"] = match data.get("checkout_number") {
        Some(Value::Number(_)) => json!(data.get("checkout_number").and_then(Value::as_f64).map(|value| value as i64)),
        Some(Value::String(text)) if !text.trim().is_empty() => {
            json!(Some(text.trim().parse::<i64>().map_err(|_| AppError::new("Checkout Number must be a whole number"))?))
        }
        _ => Value::Null,
    };
    let dashboard = match data.get("is_dashboard_visible") {
        Some(Value::Bool(value)) => i64::from(*value),
        Some(Value::Number(value)) => i64::from(value.as_f64().unwrap_or(0.0) != 0.0),
        Some(Value::String(text)) => i64::from(matches!(text.to_lowercase().as_str(), "1" | "true" | "show" | "yes")),
        _ => 0,
    };
    normalized["is_dashboard_visible"] = json!(dashboard);
    normalized["protocol"] = json!(if data.get("protocol").and_then(Value::as_str) == Some("http") { "http" } else { "https" });
    let summary = format!("{} {}", data.get("device_type").and_then(Value::as_str).unwrap_or(""), data.get("ip").and_then(Value::as_str).unwrap_or(""));
    let owned: Vec<Value> = DEVICE_COLUMNS
        .iter()
        .map(|key| {
            let raw = normalized.get(*key).cloned().unwrap_or(Value::Null);
            match raw {
                Value::String(text) if text.is_empty() => Value::Null,
                Value::String(_) | Value::Number(_) | Value::Bool(_) | Value::Null => raw,
                _ => Value::Null,
            }
        })
        .collect();
    Ok((owned, name, summary, data.get("device_type").and_then(Value::as_str).unwrap_or("").to_string()))
}

fn save_device_conn(connection: &Connection, data: &Value) -> AppResult<SavedRow> {
    let (owned, name, summary, device_type) = device_values(data)?;
    let branch_id = data.get("branch_id").and_then(Value::as_f64).map(|value| value as i64).unwrap_or(0);
    let switch_ports = if device_type == "Switch" {
        normalize_switch_ports(data.get("switch_ports").unwrap_or(&json!([])))?
    } else {
        vec![]
    };
    let _device_ip = data.get("ip").and_then(Value::as_str).unwrap_or("").to_string();
    let editing_id = as_id(data.get("id"));

    let tx = connection.unchecked_transaction()?;
    if device_type == "Router" {
        let device_id = editing_id.unwrap_or(0);
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM devices WHERE branch_id = ?1 AND device_type = 'Router' AND id <> ?2 LIMIT 1",
                rusqlite::params![branch_id, device_id],
                |row| row.get(0),
            )
            .ok();
        let current: Option<(i64, String)> = editing_id.and_then(|id| {
            tx.query_row(
                "SELECT branch_id, device_type FROM devices WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .ok()
        });
        let editing_legacy_in_place = matches!(&current, Some((branch, kind)) if kind == "Router" && *branch == branch_id);
        if existing.is_some() && !editing_legacy_in_place {
            return Err(AppError::new("Only one Router can be defined for each branch"));
        }
    }
    let params: Vec<rusqlite::types::Value> = owned.iter().map(json_to_sql).collect();
    let result_id;
    let added;
    if let Some(id) = editing_id {
        let assignments: Vec<String> = DEVICE_COLUMNS.iter().map(|key| format!("{key} = ?")).collect();
        let sql = format!(
            "UPDATE devices SET {}, updated_at = CURRENT_TIMESTAMP WHERE id = ?{}",
            assignments.join(", "),
            DEVICE_COLUMNS.len() + 1
        );
        let mut all = params.clone();
        all.push(rusqlite::types::Value::Integer(id));
        let changes = tx.execute(&sql, rusqlite::params_from_iter(all.iter())).map_err(AppError::from)?;
        if changes == 0 {
            return Err(AppError::new("Device not found"));
        }
        result_id = id;
        added = false;
    } else {
        let sql = format!(
            "INSERT INTO devices ({}) VALUES ({})",
            DEVICE_COLUMNS.join(","),
            DEVICE_COLUMNS.iter().map(|_| "?".to_string()).collect::<Vec<_>>().join(",")
        );
        tx.execute(&sql, rusqlite::params_from_iter(params.iter())).map_err(AppError::from)?;
        result_id = tx.last_insert_rowid();
        added = true;
    }
    replace_switch_ports_conn(&tx, result_id, &switch_ports)?;
    tx.commit()?;

    let ports = list_switch_ports_conn(connection, Some(result_id))?;
    let mut value = data.clone();
    value["id"] = json!(result_id);
    value["switch_ports"] = Value::Array(ports);
    Ok(SavedRow { id: result_id, name, summary, added, value })
}

pub fn replace_switch_ports_conn(connection: &Connection, device_id: i64, ports: &[Value]) -> AppResult<()> {
    connection.execute("DELETE FROM switch_ports WHERE device_id = ?1", rusqlite::params![device_id])?;
    if ports.is_empty() {
        return Ok(());
    }
    let mut insert = connection.prepare(
        "INSERT INTO switch_ports (device_id, port_number, vlan, status, ip, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for port in ports {
        let port_number = port.get("port_number").and_then(Value::as_f64).map(|value| value as i64).unwrap_or(0);
        let vlan = port.get("vlan").and_then(Value::as_str).unwrap_or("").trim();
        let status_raw = port.get("status").and_then(Value::as_str).unwrap_or("");
        let status = if ["up", "down", "disabled"].contains(&status_raw) { status_raw } else { "up" };
        let ip = port.get("ip").and_then(Value::as_str).unwrap_or("").trim();
        let details = port.get("details").and_then(Value::as_str).unwrap_or("").trim();
        insert.execute(rusqlite::params![
            device_id,
            port_number,
            if vlan.is_empty() { None } else { Some(vlan.to_string()) },
            status,
            if ip.is_empty() { None } else { Some(ip.to_string()) },
            if details.is_empty() { None } else { Some(details.to_string()) },
        ])?;
    }
    Ok(())
}

pub fn list_switch_ports_conn(connection: &Connection, device_id: Option<i64>) -> AppResult<Vec<Value>> {
    let mut stmt = match device_id {
        Some(_id) => connection.prepare("SELECT * FROM switch_ports WHERE device_id = ?1 ORDER BY port_number")?,
        None => connection.prepare("SELECT * FROM switch_ports ORDER BY device_id, port_number")?,
    };
    let rows = match device_id {
        Some(id) => {
            let mapped = stmt.query_map(rusqlite::params![id], row_to_json)?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()?
        }
        None => rows_to_json(&mut stmt)?,
    };
    Ok(rows)
}

impl AppDatabase {
    pub fn open(
        user_data_path: &Path,
        vault: std::sync::Arc<SecureVault>,
        recovery_file_path: Option<PathBuf>,
    ) -> AppResult<Self> {
        std::fs::create_dir_all(user_data_path)?;
        let file_path = user_data_path.join("hyperfamily-monitor.db");
        let database_key = vault.get_database_key()?;
        let connection = Connection::open(&file_path)?;
        connection.execute_batch(&format!(
            "PRAGMA cipher = 'sqlcipher'; PRAGMA key = \"x'{database_key}'\";"
        ))?;
        // Force an early read so a wrong key fails at startup.
        connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0))?;
        migrations::run_migrations(&connection, &bcrypt::hash("Admin", 10)?, &vault.encrypt("Admin")?)?;

        let database = Self {
            connection: Mutex::new(connection),
            vault,
            file_path: file_path.clone(),
            user_data_path: user_data_path.to_path_buf(),
            recovery_file_path,
        };
        database.sync_recovery_file();
        Ok(database)
    }

    /// Full path of the encrypted database file (shown on the About page).
    pub fn file_path(&self) -> std::path::PathBuf {
        self.file_path.clone()
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection.lock().expect("database mutex poisoned")
    }

    pub fn audit(&self, user: &str, action: &str, target: &str, details: &str) {
        let connection = self.lock();
        audit_conn(&connection, user, action, target, details);
    }

    /* ------------------------------------------------------------- recovery */

    pub fn recovery_candidates(&self) -> Vec<PathBuf> {
        let mut list = vec![self.user_data_path.join("credentials.dat")];
        if let Some(path) = &self.recovery_file_path {
            list.push(path.clone());
        }
        list
    }

    pub fn read_recovery_file(&self) -> Option<Value> {
        for file in self.recovery_candidates() {
            if let Ok(raw) = std::fs::read_to_string(&file) {
                if let Ok(payload) = self.vault.decrypt(raw.trim()) {
                    if let Ok(value) = serde_json::from_str::<Value>(&payload) {
                        return Some(value);
                    }
                }
            }
        }
        None
    }

    pub fn write_recovery_file(&self, payload: &Value) {
        let encrypted = match self.vault.encrypt(&payload.to_string()) {
            Ok(value) => value,
            Err(_) => return,
        };
        let mut targets = std::collections::HashSet::new();
        for path in self.recovery_candidates() {
            targets.insert(path);
        }
        for target in targets {
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&target, encrypted.as_bytes());
        }
    }

    pub fn sync_recovery_file(&self) {
        let result: AppResult<()> = (|| {
            let connection = self.lock();
            let admin = connection.query_row(
                "SELECT username, password_recovery, recovery_pin_hash FROM users ORDER BY id LIMIT 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0).unwrap_or_default(),
                        row.get::<_, String>(1).unwrap_or_default(),
                        row.get::<_, String>(2).unwrap_or_default(),
                    ))
                },
            )?;
            drop(connection);
            let (username, recovery, pin_hash) = admin;
            let password = if recovery.is_empty() { String::new() } else { self.vault.decrypt(&recovery)? };
            let previous = self.read_recovery_file().unwrap_or(json!({}));
            let payload = json!({
                "v": 2,
                "username": username,
                "password": password,
                "pinHash": pin_hash,
                "attempts": previous.get("attempts").and_then(Value::as_i64).unwrap_or(0),
                "lockedUntil": previous.get("lockedUntil").and_then(Value::as_i64).unwrap_or(0)
            });
            self.write_recovery_file(&payload);
            Ok(())
        })();
        let _ = result;
    }

    pub fn recovery_status(&self) -> Value {
        let pin_set = self
            .lock()
            .query_row("SELECT recovery_pin_hash FROM users ORDER BY id LIMIT 1", [], |row| {
                let hash: String = row.get(0)?;
                Ok(!hash.is_empty())
            })
            .unwrap_or(false);
        json!({ "pinSet": pin_set })
    }

    pub fn set_recovery_pin(&self, user_id: i64, pin: &str) -> AppResult<Value> {
        let digits = pin.trim();
        let valid = digits.len() >= 4 && digits.len() <= 8 && digits.chars().all(|c| c.is_ascii_digit());
        if !valid {
            return Err(AppError::new("The recovery PIN must contain 4 to 8 digits"));
        }
        let username: String = {
            let connection = self.lock();
            connection.execute(
                "UPDATE users SET recovery_pin_hash = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                rusqlite::params![hash_pin(digits), user_id],
            )?;
            connection
                .query_row("SELECT username FROM users WHERE id = ?1", rusqlite::params![user_id], |row| {
                    row.get::<_, Option<String>>(0)
                })
                .map(|value| value.unwrap_or_else(|| "Admin".into()))
                .unwrap_or_else(|_| "Admin".into())
        };
        self.audit(&username, "RECOVERY_PIN", "set", "Credential recovery PIN updated");
        self.sync_recovery_file();
        Ok(json!({ "success": true }))
    }

    pub fn verify_recovery_pin(&self, pin: &str) -> AppResult<Value> {
        let (username, recovery, pin_hash): (String, String, String) = {
            let connection = self.lock();
            connection.query_row(
                "SELECT username, password_recovery, recovery_pin_hash FROM users ORDER BY id LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?
        };
        if pin_hash.is_empty() {
            return Err(AppError::new("No recovery PIN has been set. Sign in and set one in Settings → General."));
        }
        let data = self.read_recovery_file().unwrap_or(json!({ "attempts": 0, "lockedUntil": 0 }));
        let now = chrono::Utc::now().timestamp_millis();
        let locked_until = data.get("lockedUntil").and_then(Value::as_i64).unwrap_or(0);
        if locked_until > now {
            return Ok(json!({ "ok": false, "locked": true, "retryAfterMs": locked_until - now, "remainingAttempts": 0 }));
        }
        const MAX_ATTEMPTS: i64 = 5;
        const LOCK_MS: i64 = 5 * 60 * 1000;
        if !verify_pin_hash(pin, &pin_hash) {
            let attempts = data.get("attempts").and_then(Value::as_i64).unwrap_or(0) + 1;
            let lock = attempts >= MAX_ATTEMPTS;
            self.write_recovery_file(&json!({
                "v": 2,
                "username": data.get("username").cloned().unwrap_or(json!(username)),
                "password": data.get("password").cloned().unwrap_or(json!("")),
                "pinHash": pin_hash,
                "attempts": if lock { 0 } else { attempts },
                "lockedUntil": if lock { now + LOCK_MS } else { 0 }
            }));
            self.audit(&username, "RECOVERY_PIN", "attempt", &format!("Wrong recovery PIN ({attempts})"));
            return Ok(json!({
                "ok": false, "locked": lock,
                "retryAfterMs": if lock { LOCK_MS } else { 0 },
                "remainingAttempts": if lock { 0 } else { MAX_ATTEMPTS - attempts }
            }));
        }
        let password = if recovery.is_empty() { String::new() } else { self.vault.decrypt(&recovery)? };
        self.write_recovery_file(&json!({
            "v": 2, "username": username, "password": password,
            "pinHash": pin_hash, "attempts": 0, "lockedUntil": 0
        }));
        self.audit(&username, "RECOVERY_PIN", "verify", "Credentials revealed through recovery");
        Ok(json!({ "ok": true, "username": username, "password": if password.is_empty() { Value::Null } else { json!(password) } }))
    }

    /* -------------------------------------------------- remembered credentials */

    pub fn remembered_credentials_path(&self) -> PathBuf {
        self.user_data_path.join("remembered-credentials.dat")
    }

    pub fn save_remembered_credentials(&self, payload: &Value) -> Value {
        let username = payload.get("username").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let password = payload.get("password").and_then(Value::as_str).unwrap_or("").to_string();
        if username.is_empty() || password.is_empty() {
            self.clear_remembered_credentials();
            return json!({ "saved": false });
        }
        match self.vault.encrypt(&json!({ "username": username, "password": password }).to_string()) {
            Ok(encrypted) => {
                if std::fs::write(self.remembered_credentials_path(), encrypted).is_ok() {
                    json!({ "saved": true })
                } else {
                    json!({ "saved": false })
                }
            }
            Err(_) => json!({ "saved": false }),
        }
    }

    pub fn clear_remembered_credentials(&self) -> Value {
        let _ = std::fs::remove_file(self.remembered_credentials_path());
        json!({ "saved": false })
    }

    pub fn get_remembered_credentials(&self) -> Value {
        match std::fs::read_to_string(self.remembered_credentials_path()) {
            Ok(raw) => match self.vault.decrypt(raw.trim()).ok().and_then(|p| serde_json::from_str::<Value>(&p).ok()) {
                Some(data) => json!({
                    "username": data.get("username").and_then(Value::as_str).unwrap_or(""),
                    "password": data.get("password").and_then(Value::as_str).unwrap_or("")
                }),
                None => json!({ "username": "", "password": "" }),
            },
            Err(_) => json!({ "username": "", "password": "" }),
        }
    }

    /* --------------------------------------------------------------- accounts */

    pub fn authenticate(&self, username: &str, password: &str) -> AppResult<Option<Value>> {
        let row: Option<(i64, String, String)> = {
            let connection = self.lock();
            connection
                .query_row(
                    "SELECT id, username, password FROM users WHERE username = ?1 COLLATE NOCASE",
                    rusqlite::params![username.trim()],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .ok()
        };
        let Some((id, name, hash)) = row else { return Ok(None) };
        if !bcrypt::verify(password, &hash)? {
            return Ok(None);
        }
        self.audit(&name, "LOGIN", "Application", "Successful local login");
        Ok(Some(json!({ "id": id, "username": name })))
    }

    pub fn update_credentials(&self, user_id: i64, payload: &Value) -> AppResult<Value> {
        let (existing_name, existing_hash, existing_recovery): (String, String, String) = {
            let connection = self.lock();
            connection
                .query_row(
                    "SELECT username, password, password_recovery FROM users WHERE id = ?1",
                    rusqlite::params![user_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(|_| AppError::new("Current password is incorrect"))?
        };
        let current = payload.get("currentPassword").and_then(Value::as_str).unwrap_or("");
        if !bcrypt::verify(current, &existing_hash)? {
            return Err(AppError::new("Current password is incorrect"));
        }
        let next_username = payload.get("newUsername").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let next_password = payload.get("newPassword").and_then(Value::as_str).unwrap_or("").to_string();
        if next_username.len() < 3 || next_username.len() > 64 {
            return Err(AppError::new("Username must contain between 3 and 64 characters"));
        }
        if next_username.chars().any(|c| c.is_control()) {
            return Err(AppError::new("Username contains unsupported characters"));
        }
        if !next_password.is_empty() && next_password.chars().count() < 4 {
            return Err(AppError::new("New password must contain at least 4 characters"));
        }
        let password_hash = if next_password.is_empty() { existing_hash.clone() } else { bcrypt::hash(&next_password, 10)? };
        let recovery = if next_password.is_empty() {
            if existing_recovery.is_empty() { String::new() } else { existing_recovery.clone() }
        } else {
            self.vault.encrypt(&next_password)?
        };
        {
            let connection = self.lock();
            if let Err(error) = connection.execute(
                "UPDATE users SET username = ?1, password = ?2, password_recovery = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
                rusqlite::params![next_username, password_hash, recovery, user_id],
            ) {
                let mapped: AppError = error.into();
                return Err(mapped);
            }
        }
        let mut changed = Vec::new();
        if next_username != existing_name {
            changed.push(format!("username from {existing_name} to {next_username}"));
        }
        if !next_password.is_empty() {
            changed.push("password".into());
        }
        self.audit(
            &next_username,
            "ACCOUNT_UPDATE",
            &next_username,
            &format!("Administrator {}", if changed.is_empty() { "credentials verified".into() } else { changed.join(" and ") }),
        );
        self.sync_recovery_file();
        let remembered = self.get_remembered_credentials();
        if !remembered.get("username").and_then(Value::as_str).unwrap_or("").is_empty() {
            self.save_remembered_credentials(&json!({
                "username": next_username,
                "password": if next_password.is_empty() { remembered.get("password").cloned().unwrap_or(json!("")) } else { json!(next_password) }
            }));
        }
        Ok(json!({ "id": user_id, "username": next_username }))
    }

    /* --------------------------------------------------------------- branches */

    pub fn list_branches(&self) -> AppResult<Vec<Value>> {
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare("SELECT * FROM branches ORDER BY name COLLATE NOCASE")?;
        rows_to_json(&mut stmt)
    }

    pub fn save_branch(&self, data: &Value, actor: &str) -> AppResult<Value> {
        let connection = self.lock();
        let result = save_branch_conn(&connection, data)?;
        drop(connection);
        if result.added {
            self.audit(actor, "BRANCH_ADD", &result.id.to_string(), &result.name);
        } else {
            self.audit(actor, "BRANCH_UPDATE", &result.id.to_string(), &result.name);
        }
        Ok(result.value)
    }

    /// Transaction-aware variant reused by the workbook import.
    pub fn save_branch_tx(connection: &Connection, data: &Value, actor: &str) -> AppResult<Value> {
        let result = save_branch_conn(connection, data)?;
        audit_conn(
            connection,
            actor,
            if result.added { "BRANCH_ADD" } else { "BRANCH_UPDATE" },
            &result.id.to_string(),
            &result.name,
        );
        Ok(result.value)
    }

    pub fn delete_branch(&self, id: i64, actor: &str) -> AppResult<Value> {
        let connection = self.lock();
        let name: String = connection
            .query_row("SELECT name FROM branches WHERE id = ?1", rusqlite::params![id], |row| row.get(0))
            .map_err(|_| AppError::new("Branch not found"))?;
        connection.execute("DELETE FROM branches WHERE id = ?1", rusqlite::params![id])?;
        drop(connection);
        self.audit(actor, "BRANCH_DELETE", &id.to_string(), &name);
        Ok(json!({ "success": true }))
    }

    pub fn delete_all_branches_and_devices(&self, actor: &str) -> AppResult<Value> {
        let counts = {
            let connection = self.lock();
            let device_count: i64 = connection.query_row("SELECT count(*) FROM devices", [], |row| row.get(0))?;
            let branch_count: i64 = connection.query_row("SELECT count(*) FROM branches", [], |row| row.get(0))?;
            let tx = connection.unchecked_transaction()?;
            for table in [
                "switch_ports",
                "device_credential_assignments",
                "device_credentials",
                "ping_history",
                "uptime_logs",
                "devices",
                "branches",
            ] {
                tx.execute(&format!("DELETE FROM {table}"), [])?;
            }
            tx.commit()?;
            (device_count, branch_count)
        };
        self.audit(
            actor,
            "DIRECTORY_CLEAR",
            "all",
            &format!("{} branches and {} devices permanently removed", counts.1, counts.0),
        );
        Ok(json!({ "success": true, "deviceCount": counts.0, "branchCount": counts.1 }))
    }

    /* ---------------------------------------------------------------- devices */

    pub fn list_switch_ports(&self, device_id: Option<i64>) -> AppResult<Vec<Value>> {
        let connection = self.lock();
        list_switch_ports_conn(&connection, device_id)
    }

    fn attach_switch_ports(&self, mut devices: Vec<Value>) -> AppResult<Vec<Value>> {
        let ports = self.list_switch_ports(None)?;
        for device in devices.iter_mut() {
            let id = device.get("id").and_then(Value::as_i64).unwrap_or(0);
            let owned: Vec<Value> = ports
                .iter()
                .filter(|port| port.get("device_id").and_then(Value::as_i64) == Some(id))
                .cloned()
                .collect();
            device["switch_ports"] = Value::Array(owned);
        }
        Ok(devices)
    }

    pub fn list_devices(&self) -> AppResult<Vec<Value>> {
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare(
            "SELECT d.*, p.status, p.ping_time
             FROM devices d
             LEFT JOIN ping_history p ON p.id = (SELECT id FROM ping_history WHERE device_id = d.id ORDER BY id DESC LIMIT 1)
             ORDER BY d.branch_id, d.device_type, d.name COLLATE NOCASE",
        )?;
        let devices = rows_to_json(&mut stmt)?;
        self.attach_switch_ports(devices)
    }

    pub fn get_device(&self, id: i64) -> AppResult<Option<Value>> {
        let device = {
            let lock_guard = self.lock();
            let mut stmt = lock_guard.prepare("SELECT * FROM devices WHERE id = ?1")?;
            let mut rows = stmt.query_map(rusqlite::params![id], row_to_json)?;
            match rows.next() {
                Some(row) => Some(row?),
                None => None,
            }
        };
        match device {
            Some(mut value) => {
                let device_id = value.get("id").and_then(Value::as_i64).unwrap_or(id);
                value["switch_ports"] = json!(self.list_switch_ports(Some(device_id))?);
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    pub fn list_monitored_devices(&self) -> AppResult<Vec<Value>> {
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare("SELECT * FROM devices WHERE is_dashboard_visible = 1 ORDER BY id")?;
        rows_to_json(&mut stmt)
    }


    pub fn save_device(&self, data: &Value, actor: &str) -> AppResult<Value> {
        let connection = self.lock();
        let result = save_device_conn(&connection, data)?;
        drop(connection);
        if result.added {
            self.audit(actor, "DEVICE_ADD", &result.id.to_string(), &result.summary);
        } else {
            self.audit(actor, "DEVICE_UPDATE", &result.id.to_string(), &result.summary);
        }
        Ok(result.value)
    }

    /// Transaction-aware variant reused by the workbook import.
    pub fn save_device_tx(connection: &Connection, data: &Value, actor: &str) -> AppResult<Value> {
        let result = save_device_conn(connection, data)?;
        audit_conn(
            connection,
            actor,
            if result.added { "DEVICE_ADD" } else { "DEVICE_UPDATE" },
            &result.id.to_string(),
            &result.summary,
        );
        Ok(result.value)
    }

    pub fn import_directory(&self, payload: &Value, actor: &str) -> AppResult<Value> {
        let empty = vec![];
        let branch_rows = payload.get("branches").and_then(Value::as_array).unwrap_or(&empty).clone();
        let device_rows = payload.get("devices").and_then(Value::as_array).unwrap_or(&empty).clone();
        let mut branches_added = 0i64;
        let mut branches_updated = 0i64;
        let mut devices_added = 0i64;
        let mut devices_updated = 0i64;
        let mut switch_ports_imported = 0i64;
        {
            let connection = self.lock();
            let tx = connection.unchecked_transaction()?;
            for branch in &branch_rows {
                let code = branch.get("code").and_then(Value::as_str).unwrap_or("");
                let existing: Option<i64> = tx
                    .query_row("SELECT id FROM branches WHERE code = ?1 COLLATE NOCASE", rusqlite::params![code], |row| row.get(0))
                    .ok();
                let mut data = branch.clone();
                if let Some(id) = existing {
                    data["id"] = json!(id);
                }
                if existing.is_some() {
                    branches_updated += 1;
                } else {
                    branches_added += 1;
                }
                Self::save_branch_tx(&tx, &data, actor)?;
            }
            for device in &device_rows {
                let branch_code = device.get("branch_code").and_then(Value::as_str).unwrap_or("");
                let branch_id: i64 = tx
                    .query_row(
                        "SELECT id FROM branches WHERE code = ?1 COLLATE NOCASE",
                        rusqlite::params![branch_code],
                        |row| row.get(0),
                    )
                    .map_err(|_| AppError::new(format!("Branch Code \"{branch_code}\" does not exist")))?;
                let device_type = device.get("device_type").and_then(Value::as_str).unwrap_or("");
                let ip = device.get("ip").and_then(Value::as_str).unwrap_or("");
                let existing: Option<i64> = if device_type == "Router" {
                    tx.query_row(
                        "SELECT id FROM devices WHERE branch_id = ?1 AND device_type = 'Router' LIMIT 1",
                        rusqlite::params![branch_id],
                        |row| row.get(0),
                    )
                    .ok()
                } else {
                    tx.query_row(
                        "SELECT id FROM devices WHERE branch_id = ?1 AND device_type = ?2 AND ip = ?3 COLLATE NOCASE LIMIT 1",
                        rusqlite::params![branch_id, device_type, ip],
                        |row| row.get(0),
                    )
                    .ok()
                };
                let mut data = device.clone();
                data["branch_id"] = json!(branch_id);
                if let Some(id) = existing {
                    data["id"] = json!(id);
                }
                if existing.is_some() {
                    devices_updated += 1;
                } else {
                    devices_added += 1;
                }
                let saved = Self::save_device_tx(&tx, &data, actor)?;
                if device_type == "Switch" {
                    switch_ports_imported += saved.get("switch_ports").and_then(Value::as_array).map(Vec::len).unwrap_or(0) as i64;
                }
            }
            tx.commit()?;
        }
        let branch_changes = branches_added + branches_updated;
        let device_changes = devices_added + devices_updated;
        self.audit(
            actor,
            "DIRECTORY_IMPORT",
            "Excel workbook",
            &format!("{branch_changes} branches, {device_changes} devices, {switch_ports_imported} switch ports processed"),
        );
        Ok(json!({
            "success": true,
            "branches_added": branches_added, "branches_updated": branches_updated,
            "devices_added": devices_added, "devices_updated": devices_updated,
            "switch_ports_imported": switch_ports_imported
        }))
    }

    pub fn delete_device(&self, id: i64, actor: &str) -> AppResult<Value> {
        let Some(device) = self.get_device(id)? else {
            return Err(AppError::new("Device not found"));
        };
        let kind = device.get("device_type").and_then(Value::as_str).unwrap_or("");
        let ip = device.get("ip").and_then(Value::as_str).unwrap_or("");
        self.lock().execute("DELETE FROM devices WHERE id = ?1", rusqlite::params![id])?;
        self.audit(actor, "DEVICE_DELETE", &id.to_string(), &format!("{kind} {ip}"));
        Ok(json!({ "success": true }))
    }

    /* --------------------------------------------------------------- settings */

    pub fn get_settings(&self) -> AppResult<Value> {
        let mut result = Map::new();
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare("SELECT key, value FROM settings")?;
        let rows: Vec<(String, String)> = {
            let mapped = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()?
        };
        drop(stmt);
        for (key, value) in rows {
            let parsed: Value = match serde_json::from_str(&value) {
                Ok(parsed) => parsed,
                Err(_) => {
                    result.insert(key.clone(), json!(value));
                    continue;
                }
            };
            if SENSITIVE_SETTINGS.contains(&key.as_str()) && !parsed.is_null() {
                let decrypted = match parsed.as_str() {
                    Some(text) => self.vault.decrypt(text)?,
                    None => parsed.to_string(),
                };
                result.insert(key, json!(decrypted));
            } else {
                result.insert(key, parsed);
            }
        }
        Ok(Value::Object(result))
    }

    pub fn save_settings(&self, patch: &Value, actor: &str) -> AppResult<Value> {
        let Value::Object(items) = patch else { return Err(AppError::new("Invalid settings payload")) };
        {
            let connection = self.lock();
            let mut stmt = connection.prepare(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
            )?;
            for (key, value) in items {
                let valid = !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
                if !valid {
                    continue;
                }
                let stored = if SENSITIVE_SETTINGS.contains(&key.as_str()) && !value.is_null() {
                    let text = value.as_str().map(String::from).unwrap_or_else(|| value.to_string());
                    json!(self.vault.encrypt(&text)?)
                } else {
                    value.clone()
                };
                stmt.execute(rusqlite::params![key, stored.to_string()])?;
            }
        }
        let keys: Vec<String> = items.keys().cloned().collect();
        self.audit(actor, "SETTINGS_UPDATE", &keys.join(","), "Application settings updated");
        self.get_settings()
    }

    /* ------------------------------------------------------------ credentials */

    pub fn list_credentials(&self) -> AppResult<Vec<Value>> {
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare("SELECT id, name, username, created_at, 1 AS has_password FROM credentials ORDER BY name COLLATE NOCASE")?;
        rows_to_json(&mut stmt)
    }

    pub fn reveal_credential(&self, id: i64) -> AppResult<String> {
        let connection = self.lock();
        let row: Option<String> = connection
            .query_row("SELECT password FROM credentials WHERE id = ?1", rusqlite::params![id], |row| row.get(0))
            .ok();
        drop(connection);
        row.map(|text| self.vault.decrypt(&text))
            .transpose()?
            .ok_or_else(|| AppError::new("Credential not found"))
    }

    pub fn get_credential(&self, id: i64) -> AppResult<Option<Value>> {
        if id == 0 {
            return Ok(None);
        }
        let row = {
            let lock_guard = self.lock();
            let mut stmt = lock_guard.prepare("SELECT * FROM credentials WHERE id = ?1")?;
            let mut rows = stmt.query_map(rusqlite::params![id], row_to_json)?;
            rows.next().transpose()?
        };
        match row {
            Some(mut value) => {
                let encrypted = value.get("password").and_then(Value::as_str).unwrap_or("").to_string();
                value["password"] = json!(self.vault.decrypt(&encrypted)?);
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    pub fn save_credential(&self, data: &Value, actor: &str) -> AppResult<Value> {
        let name = data.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let username = data.get("username").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let password = data.get("password").and_then(Value::as_str).unwrap_or("").to_string();
        if name.is_empty() || username.is_empty() || password.is_empty() {
            return Err(AppError::new("Name, username, and password are required"));
        }
        let encrypted = self.vault.encrypt(&password)?;
        let row_id = {
            let connection = self.lock();
            connection.execute(
                "INSERT INTO credentials (name, username, password) VALUES (?1, ?2, ?3)",
                rusqlite::params![name, username, encrypted],
            )?;
            connection.last_insert_rowid()
        };
        self.audit(actor, "CREDENTIAL_ADD", &row_id.to_string(), &name);
        Ok(json!({ "id": row_id, "name": name, "username": username, "has_password": 1 }))
    }

    pub fn delete_credential(&self, id: i64, actor: &str) -> AppResult<Value> {
        let name: String = {
            let connection = self.lock();
            let name = connection
                .query_row("SELECT name FROM credentials WHERE id = ?1", rusqlite::params![id], |row| row.get(0))
                .map_err(|_| AppError::new("Credential not found"))?;
            connection.execute("DELETE FROM credentials WHERE id = ?1", rusqlite::params![id])?;
            name
        };
        self.audit(actor, "CREDENTIAL_DELETE", &id.to_string(), &name);
        Ok(json!({ "success": true }))
    }

    fn get_mappings(&self) -> Value {
        let mut result = Map::new();
        let connection = self.lock();
        let mut stmt = match connection.prepare("SELECT device_type, credential_id FROM device_credentials ORDER BY device_type") {
            Ok(stmt) => stmt,
            Err(_) => return Value::Object(result),
        };
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)));
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (device_type, credential_id) = row;
                let entry = result.entry(device_type).or_insert_with(|| Value::Array(vec![]));
                if let Value::Array(list) = entry {
                    list.push(json!(credential_id));
                }
            }
        }
        Value::Object(result)
    }

    fn get_device_mappings(&self) -> Value {
        let mut result = Map::new();
        let connection = self.lock();
        let mut stmt = match connection
            .prepare("SELECT device_id, credential_id FROM device_credential_assignments ORDER BY device_id")
        {
            Ok(stmt) => stmt,
            Err(_) => return Value::Object(result),
        };
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)));
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (device_id, credential_id) = row;
                let entry = result.entry(device_id.to_string()).or_insert_with(|| Value::Array(vec![]));
                if let Value::Array(list) = entry {
                    list.push(json!(credential_id));
                }
            }
        }
        Value::Object(result)
    }

    pub fn get_credential_map(&self) -> Value {
        json!({ "types": self.get_mappings(), "devices": self.get_device_mappings() })
    }

    pub fn save_mappings(&self, mappings: &Value, actor: &str) -> AppResult<Value> {
        let has_unified = mappings.get("types").is_some() || mappings.get("devices").is_some();
        let (types, devices) = if has_unified {
            (mappings.get("types"), mappings.get("devices"))
        } else {
            (Some(mappings), None)
        };
        {
            let connection = self.lock();
            let tx = connection.unchecked_transaction()?;
            if let Some(types) = types.filter(|value| value.is_object()) {
                tx.execute("DELETE FROM device_credentials", [])?;
                let mut insert = tx.prepare("INSERT OR IGNORE INTO device_credentials (device_type, credential_id) VALUES (?1, ?2)")?;
                if let Value::Object(entries) = types {
                    for (device_type, ids) in entries {
                        for id in ids.as_array().unwrap_or(&vec![]) {
                            insert.execute(rusqlite::params![device_type, id.as_i64().unwrap_or(0)])?;
                        }
                    }
                }
            }
            if let Some(devices) = devices.filter(|value| value.is_object()) {
                tx.execute("DELETE FROM device_credential_assignments", [])?;
                let mut insert = tx.prepare("INSERT OR IGNORE INTO device_credential_assignments (device_id, credential_id) VALUES (?1, ?2)")?;
                if let Value::Object(entries) = devices {
                    for (device_id, ids) in entries {
                        for id in ids.as_array().unwrap_or(&vec![]) {
                            insert.execute(rusqlite::params![device_id.parse::<i64>().unwrap_or(0), id.as_i64().unwrap_or(0)])?;
                        }
                    }
                }
            }
            tx.commit()?;
        }
        self.audit(actor, "CREDENTIAL_MAPPING_UPDATE", "Devices and device types", "Credential mappings updated");
        Ok(self.get_credential_map())
    }

    pub fn set_device_credential(&self, device_id: i64, credential_id: Option<i64>, actor: &str) -> AppResult<Value> {
        let device = self.get_device(device_id)?.ok_or_else(|| AppError::new("Device not found"))?;
        let device_name = device.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        if let Some(credential_id) = credential_id.filter(|id| *id != 0) {
            let credential: (i64, String) = {
                let connection = self.lock();
                connection
                    .query_row(
                        "SELECT id, name FROM credentials WHERE id = ?1",
                        rusqlite::params![credential_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .map_err(|_| AppError::new("Credential not found"))?
            };
            {
                let connection = self.lock();
                let tx = connection.unchecked_transaction()?;
                tx.execute("DELETE FROM device_credential_assignments WHERE device_id = ?1", rusqlite::params![device_id])?;
                tx.execute(
                    "INSERT OR IGNORE INTO device_credential_assignments (device_id, credential_id) VALUES (?1, ?2)",
                    rusqlite::params![device_id, credential_id],
                )?;
                tx.commit()?;
            }
            self.audit(actor, "CREDENTIAL_ASSIGN", &device_id.to_string(), &format!("{} → {}", credential.1, device_name));
        } else {
            self.lock().execute(
                "DELETE FROM device_credential_assignments WHERE device_id = ?1",
                rusqlite::params![device_id],
            )?;
            self.audit(actor, "CREDENTIAL_UNASSIGN", &device_id.to_string(), &format!("Cleared the credential of {device_name}"));
        }
        self.get_device_credential_state(device_id)
    }

    pub fn set_type_credential(&self, device_type: &str, credential_id: Option<i64>, actor: &str) -> AppResult<Value> {
        let device_type = device_type.trim();
        if device_type.is_empty() {
            return Err(AppError::new("A device type is required"));
        }
        if let Some(credential_id) = credential_id.filter(|id| *id != 0) {
            let credential_name: String = {
                let connection = self.lock();
                connection
                    .query_row(
                        "SELECT name FROM credentials WHERE id = ?1",
                        rusqlite::params![credential_id],
                        |row| row.get(0),
                    )
                    .map_err(|_| AppError::new("Credential not found"))?
            };
            {
                let connection = self.lock();
                let tx = connection.unchecked_transaction()?;
                tx.execute("DELETE FROM device_credentials WHERE device_type = ?1", rusqlite::params![device_type])?;
                tx.execute(
                    "INSERT OR IGNORE INTO device_credentials (device_type, credential_id) VALUES (?1, ?2)",
                    rusqlite::params![device_type, credential_id],
                )?;
                tx.commit()?;
            }
            self.audit(actor, "CREDENTIAL_ASSIGN_TYPE", device_type, &format!("{credential_name} → every {device_type}"));
        } else {
            self.lock().execute("DELETE FROM device_credentials WHERE device_type = ?1", rusqlite::params![device_type])?;
            self.audit(actor, "CREDENTIAL_UNASSIGN_TYPE", device_type, &format!("Cleared the default credential for {device_type}"));
        }
        Ok(json!({ "device_type": device_type, "credential_id": credential_id }))
    }

    pub fn get_device_credential_state(&self, device_id: i64) -> AppResult<Value> {
        let connection = self.lock();
        let device: Option<(i64, String)> = connection
            .query_row(
                "SELECT id, device_type FROM devices WHERE id = ?1",
                rusqlite::params![device_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        let Some((id, device_type)) = device else { return Ok(Value::Null) };
        let direct: Option<(i64, String, String)> = connection
            .query_row(
                "SELECT c.id, c.name, c.username
                 FROM device_credential_assignments a JOIN credentials c ON c.id = a.credential_id
                 WHERE a.device_id = ?1 LIMIT 1",
                rusqlite::params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();
        let inherited: Option<(i64, String, String)> = connection
            .query_row(
                "SELECT c.id, c.name, c.username
                 FROM device_credentials t JOIN credentials c ON c.id = t.credential_id
                 WHERE t.device_type = ?1 LIMIT 1",
                rusqlite::params![device_type],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();
        let effective = direct.clone().or_else(|| inherited.clone());
        Ok(json!({
            "device_id": id,
            "device_type": device_type,
            "credential_id": direct.as_ref().map(|(id, _, _)| *id),
            "effective": effective.map(|(id, name, username)| json!({ "id": id, "name": name, "username": username })),
            "source": if direct.is_some() { "device" } else if inherited.is_some() { "type" } else { "none" }
        }))
    }

    pub fn list_device_credential_overview(&self) -> AppResult<Vec<Value>> {
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare(
            "SELECT d.id AS device_id, d.name AS device_name, d.device_type, d.ip,
                    b.name AS branch_name, b.id AS branch_id,
                    dc.id AS direct_id, dc.name AS direct_name,
                    tc.id AS type_id, tc.name AS type_name
             FROM devices d
             LEFT JOIN branches b ON b.id = d.branch_id
             LEFT JOIN device_credential_assignments a ON a.device_id = d.id
             LEFT JOIN credentials dc ON dc.id = a.credential_id
             LEFT JOIN device_credentials t ON t.device_type = d.device_type
             LEFT JOIN credentials tc ON tc.id = t.credential_id
             GROUP BY d.id
             ORDER BY b.name COLLATE NOCASE, d.name COLLATE NOCASE",
        )?;
        let rows: Vec<Value> = rows_to_json(&mut stmt)?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let direct_id = row.get("direct_id").cloned().unwrap_or(Value::Null);
                let direct_name = row.get("direct_name").and_then(Value::as_str).unwrap_or("").to_string();
                let type_name = row.get("type_name").and_then(Value::as_str).unwrap_or("").to_string();
                let type_id = row.get("type_id").cloned().unwrap_or(Value::Null);
                json!({
                    "device_id": row.get("device_id").cloned().unwrap_or(Value::Null),
                    "device_name": row.get("device_name").cloned().unwrap_or(Value::Null),
                    "device_type": row.get("device_type").cloned().unwrap_or(Value::Null),
                    "ip": row.get("ip").cloned().unwrap_or(Value::Null),
                    "branch_id": row.get("branch_id").cloned().unwrap_or(Value::Null),
                    "branch_name": row.get("branch_name").and_then(Value::as_str).filter(|text| !text.is_empty()).unwrap_or("—"),
                    "credential_id": direct_id,
                    "effective_name": if !direct_name.is_empty() { json!(direct_name) } else if !type_name.is_empty() { json!(type_name) } else { Value::Null },
                    "source": if !direct_name.is_empty() && !direct_id.is_null() { "device" } else if !type_name.is_empty() && !type_id.is_null() { "type" } else { "none" }
                })
            })
            .collect())
    }

    pub fn list_credentials_for_device(&self, device_id: i64) -> AppResult<Vec<Value>> {
        let device: Option<(i64, String)> = {
            let connection = self.lock();
            connection
                .query_row(
                    "SELECT id, device_type FROM devices WHERE id = ?1",
                    rusqlite::params![device_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok()
        };
        let Some((_id, _device_type)) = device else { return Ok(vec![]) };
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare(
            "SELECT c.id, c.name, c.username, 1 AS has_password, 'device' AS scope
                 FROM device_credential_assignments a JOIN credentials c ON c.id = a.credential_id
                 WHERE a.device_id = ?1
             UNION
             SELECT c.id, c.name, c.username, 1 AS has_password, 'type' AS scope
                 FROM device_credentials t JOIN credentials c ON c.id = t.credential_id
                 WHERE t.device_type = ?2",
        )?;
        let mut rows = rows_to_json(&mut stmt)?;
        drop(stmt);
        // Device-scoped credentials first, then name order inside each scope.
        rows.sort_by(|a, b| {
            let scope_a = a.get("scope").and_then(Value::as_str).unwrap_or("");
            let scope_b = b.get("scope").and_then(Value::as_str).unwrap_or("");
            let weight = |scope: &str| if scope == "device" { 0 } else { 1 };
            weight(scope_a).cmp(&weight(scope_b)).then_with(|| {
                a.get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_lowercase()
                    .cmp(&b.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase())
            })
        });
        let mut seen = std::collections::HashSet::new();
        rows.retain(|row| {
            let id = row.get("id").and_then(Value::as_i64).unwrap_or(0);
            seen.insert(id)
        });
        Ok(rows)
    }

    pub fn resolve_device_credential(&self, device_id: i64) -> AppResult<Option<Value>> {
        match self.list_credentials_for_device(device_id)?.first().and_then(|row| row.get("id").and_then(Value::as_i64)) {
            Some(id) => self.get_credential(id),
            None => Ok(None),
        }
    }

    /* ------------------------------------------------------------------ notes */

    pub fn list_notes(&self) -> AppResult<Vec<Value>> {
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare(
            "SELECT id, name, body, pinned, color, priority, tags, created_at, updated_at
             FROM notes ORDER BY pinned DESC, priority DESC, updated_at DESC",
        )?;
        let rows = rows_to_json(&mut stmt)?;
        Ok(rows
            .into_iter()
            .map(|mut row| {
                let tags = parse_tags(row.get("tags").and_then(Value::as_str));
                row["tags"] = json!(tags);
                row
            })
            .collect())
    }

    pub fn save_note(&self, payload: &Value, actor: &str) -> AppResult<Value> {
        let name = payload.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if name.is_empty() {
            return Err(AppError::new("A note needs a name"));
        }
        let body = payload.get("body").and_then(Value::as_str).unwrap_or("").to_string();
        let pinned = i64::from(matches!(payload.get("pinned"), Some(value) if value.as_bool().unwrap_or(false) || value.as_i64().unwrap_or(0) != 0));
        let color = payload
            .get("color")
            .and_then(Value::as_str)
            .filter(|color| NOTE_COLORS.contains(color))
            .unwrap_or("default");
        let priority = payload
            .get("priority")
            .and_then(Value::as_i64)
            .unwrap_or_else(|| payload.get("priority").and_then(Value::as_str).and_then(|text| text.parse::<i64>().ok()).unwrap_or(0))
            .clamp(0, 2);
        let tags = sanitise_tags(payload.get("tags").unwrap_or(&Value::Null));
        let tags_json = json!(tags).to_string();
        let connection = self.lock();
        if let Some(id) = payload.get("id").and_then(Value::as_i64) {
            connection.execute(
                "UPDATE notes SET name = ?1, body = ?2, pinned = ?3, color = ?4, priority = ?5, tags = ?6, updated_at = CURRENT_TIMESTAMP WHERE id = ?7",
                rusqlite::params![name, body, pinned, color, priority, tags_json, id],
            )?;
            drop(connection);
            self.audit(actor, "NOTE_UPDATE", &name, &format!("Note {id}"));
            let mut row = {
                let lock_guard = self.lock();
                let mut stmt = lock_guard.prepare("SELECT * FROM notes WHERE id = ?1")?;
                let mut rows = stmt.query_map(rusqlite::params![id], row_to_json)?;
                rows.next().transpose()?.unwrap_or(json!({}))
            };
            row["tags"] = json!(tags);
            return Ok(row);
        }
        let _row_id = connection.execute(
            "INSERT INTO notes (name, body, pinned, color, priority, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![name, body, pinned, color, priority, tags_json],
        )?;
        let row_id = connection.last_insert_rowid();
        drop(connection);
        self.audit(actor, "NOTE_CREATE", &name, &format!("Note {row_id}"));
        let mut row = {
            let lock_guard = self.lock();
            let mut stmt = lock_guard.prepare("SELECT * FROM notes WHERE id = ?1")?;
            let mut rows = stmt.query_map(rusqlite::params![row_id], row_to_json)?;
            rows.next().transpose()?.unwrap_or(json!({}))
        };
        row["tags"] = json!(tags);
        Ok(row)
    }

    pub fn delete_note(&self, id: i64, actor: &str) -> AppResult<bool> {
        let name: Option<String> = {
            let connection = self.lock();
            let name = connection
                .query_row("SELECT name FROM notes WHERE id = ?1", rusqlite::params![id], |row| row.get(0))
                .ok();
            connection.execute("DELETE FROM notes WHERE id = ?1", rusqlite::params![id])?;
            name
        };
        if let Some(name) = name {
            self.audit(actor, "NOTE_DELETE", &name, &format!("Note {id}"));
        }
        Ok(true)
    }

    /* --------------------------------------------------------------- snippets */

    pub fn list_snippets(&self) -> AppResult<Vec<Value>> {
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare(
            "SELECT id, name, command, description, created_at, updated_at FROM terminal_snippets ORDER BY name COLLATE NOCASE",
        )?;
        rows_to_json(&mut stmt)
    }

    pub fn save_snippet(&self, payload: &Value, actor: &str) -> AppResult<Value> {
        let name = payload.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let command = payload.get("command").and_then(Value::as_str).unwrap_or("").replace("\r\n", "\n").replace('\r', "\n").trim().to_string();
        if name.is_empty() {
            return Err(AppError::new("A snippet needs a name"));
        }
        if command.is_empty() {
            return Err(AppError::new("A snippet needs a command"));
        }
        if command.len() > 20000 {
            return Err(AppError::new("A snippet cannot be longer than 20000 characters"));
        }
        let description = payload.get("description").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let description = if description.is_empty() { None } else { Some(description) };
        let line_count = command.lines().filter(|line| !line.trim().is_empty()).count();
        let summary = if line_count > 1 { format!("{line_count} lines") } else { command.clone() };
        let connection = self.lock();
        if let Some(id) = payload.get("id").and_then(Value::as_i64) {
            connection.execute(
                "UPDATE terminal_snippets SET name = ?1, command = ?2, description = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
                rusqlite::params![name, command, description, id],
            )?;
            drop(connection);
            self.audit(actor, "SNIPPET_UPDATE", &name, &summary);
            let lock_guard = self.lock();
            let mut stmt = lock_guard.prepare("SELECT * FROM terminal_snippets WHERE id = ?1")?;
            let mut rows = stmt.query_map(rusqlite::params![id], row_to_json)?;
            return rows.next().transpose()?.ok_or_else(|| AppError::new("Snippet not found"));
        }
        connection.execute(
            "INSERT INTO terminal_snippets (name, command, description) VALUES (?1, ?2, ?3)",
            rusqlite::params![name, command, description],
        )?;
        let row_id = connection.last_insert_rowid();
        drop(connection);
        self.audit(actor, "SNIPPET_CREATE", &name, &summary);
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare("SELECT * FROM terminal_snippets WHERE id = ?1")?;
        let mut rows = stmt.query_map(rusqlite::params![row_id], row_to_json)?;
        rows.next().transpose()?.ok_or_else(|| AppError::new("Snippet not found"))
    }

    pub fn delete_snippet(&self, id: i64, actor: &str) -> AppResult<bool> {
        let name: Option<String> = {
            let connection = self.lock();
            let name = connection
                .query_row("SELECT name FROM terminal_snippets WHERE id = ?1", rusqlite::params![id], |row| row.get(0))
                .ok();
            connection.execute("DELETE FROM terminal_snippets WHERE id = ?1", rusqlite::params![id])?;
            name
        };
        if let Some(name) = name {
            self.audit(actor, "SNIPPET_DELETE", &name, &format!("Snippet {id}"));
        }
        Ok(true)
    }

    pub fn list_terminal_targets(&self) -> AppResult<Vec<Value>> {
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare(
            "SELECT d.id, d.name, d.ip, d.transport, d.model, d.location,
                    b.id AS branch_id, b.name AS branch_name, b.code AS branch_code
             FROM devices d JOIN branches b ON b.id = d.branch_id
             WHERE d.device_type = 'Switch'
             ORDER BY b.name COLLATE NOCASE, d.name COLLATE NOCASE",
        )?;
        let rows = rows_to_json(&mut stmt)?;
        let mut branches: Vec<Value> = Vec::new();
        for row in rows {
            let branch_id = row.get("branch_id").and_then(Value::as_i64).unwrap_or(0);
            let entry = branches
                .iter_mut()
                .find(|branch| branch.get("id").and_then(Value::as_i64) == Some(branch_id));
            let entry = match entry {
                Some(entry) => entry,
                None => {
                    branches.push(json!({
                        "id": branch_id,
                        "name": row.get("branch_name").cloned().unwrap_or(Value::Null),
                        "code": row.get("branch_code").cloned().unwrap_or(Value::Null),
                        "switches": []
                    }));
                    branches.last_mut().expect("just pushed")
                }
            };
            let transport = if row.get("transport").and_then(Value::as_str) == Some("telnet") { "telnet" } else { "ssh" };
            entry["switches"].as_array_mut().expect("array").push(json!({
                "id": row.get("id").cloned().unwrap_or(Value::Null),
                "name": row.get("name").cloned().unwrap_or(Value::Null),
                "ip": row.get("ip").cloned().unwrap_or(Value::Null),
                "model": row.get("model").cloned().unwrap_or(Value::Null),
                "location": row.get("location").cloned().unwrap_or(Value::Null),
                "transport": transport
            }));
        }
        Ok(branches)
    }

    /* ------------------------------------------------------------- monitoring */

    pub fn record_ping_batch(&self, results: &[Value]) -> AppResult<()> {
        let connection = self.lock();
        let tx = connection.unchecked_transaction()?;
        {
            let mut insert = tx.prepare("INSERT INTO ping_history (device_id, ping_time, status) VALUES (?1, ?2, ?3)")?;
            let mut update = tx.prepare(
                "INSERT INTO uptime_logs (device_id, uptime_percent, total_checks, successful_checks, date)
                 VALUES (?1, ?2, 1, ?3, date('now','localtime'))
                 ON CONFLICT(device_id, date) DO UPDATE SET
                   total_checks = total_checks + 1,
                   successful_checks = successful_checks + excluded.successful_checks,
                   uptime_percent = ((successful_checks + excluded.successful_checks) * 100.0) / (total_checks + 1)",
            )?;
            let mut prune = tx.prepare(
                "DELETE FROM ping_history WHERE device_id = ?1 AND id NOT IN
                 (SELECT id FROM ping_history WHERE device_id = ?1 ORDER BY id DESC LIMIT 1000)",
            )?;
            for result in results {
                let device_id = result.get("device_id").and_then(Value::as_i64).unwrap_or(0);
                let ping_time = result
                    .get("ping_time")
                    .and_then(Value::as_i64);
                let status = result.get("status").and_then(Value::as_str).unwrap_or("offline");
                insert.execute(rusqlite::params![device_id, ping_time, status])?;
                let success = i64::from(status != "offline");
                update.execute(rusqlite::params![device_id, success * 100, success])?;
                prune.execute(rusqlite::params![device_id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_monitor_snapshot(&self, history_count: i64) -> AppResult<Value> {
        let branches = self.list_branches()?;
        let devices = self
            .list_devices()?
            .into_iter()
            .filter(|device| device.get("is_dashboard_visible").and_then(Value::as_i64).unwrap_or(0) != 0)
            .map(|mut device| {
                let id = device.get("id").and_then(Value::as_i64).unwrap_or(0);
                device["status"] = device.get("status").cloned().filter(|value| !value.is_null()).unwrap_or(json!("unknown"));
                let history = {
                    let connection = self.lock();
                    let rows = connection
                        .prepare(
                            "SELECT ping_time, status, timestamp FROM ping_history WHERE device_id = ?1 ORDER BY id DESC LIMIT ?2",
                        )
                        .and_then(|mut prepared| {
                            let rows = prepared.query_map(rusqlite::params![id, history_count], row_to_json)?;
                            let rows = rows.collect::<rusqlite::Result<Vec<Value>>>().unwrap_or_default();
                            Ok(rows)
                        })
                        .unwrap_or_default();
                    let mut rows = rows;
                    rows.reverse();
                    for (index, row) in rows.iter_mut().enumerate() {
                        row["sequence"] = json!(index + 1);
                    }
                    rows
                };
                device["history"] = Value::Array(history);
                device
            })
            .collect::<Vec<_>>();
        Ok(json!({ "branches": branches, "devices": devices, "generated_at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) }))
    }

    pub fn list_inventory(&self) -> AppResult<Vec<Value>> {
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare(
            "SELECT d.*, b.name AS branch_name, b.code AS branch_code, b.warehouse_code AS branch_warehouse_code, p.status, p.ping_time
             FROM devices d JOIN branches b ON b.id = d.branch_id
             LEFT JOIN ping_history p ON p.id = (SELECT id FROM ping_history WHERE device_id = d.id ORDER BY id DESC LIMIT 1)
             ORDER BY b.name, d.device_type, d.name",
        )?;
        let rows = rows_to_json(&mut stmt)?;
        self.attach_switch_ports(rows)
    }

    pub fn list_audit(&self, limit: i64) -> AppResult<Vec<Value>> {
        let _limit = limit.clamp(1, 1000);
        let lock_guard = self.lock();
        let mut stmt = lock_guard.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?1")?;
        rows_to_json(&mut stmt)
    }

    /// Binds convenience wrapper for statements executed with params above.
    pub fn with_connection<T>(&self, task: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let connection = self.lock();
        task(&connection)
    }
}
