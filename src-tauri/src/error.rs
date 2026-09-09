use serde::{ser::Serializer, Serialize};

/// Every backend failure crosses the bridge as `{ message }` so the renderer
/// can keep reading `error.message` exactly like it did with Electron IPC.
#[derive(Debug, Clone)]
pub struct AppError {
    pub message: String,
    /// Optional structured payload that a caller wants preserved through the
    /// pipeline (e.g. the deploy summary carries its `backup` name onward).
    pub payload: Option<serde_json::Value>,
}

impl AppError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), payload: None }
    }

    pub fn with_payload(message: impl Into<String>, payload: serde_json::Value) -> Self {
        Self { message: message.into(), payload: Some(payload) }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.message)
    }
}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        Self { message: value, payload: None }
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        Self { message: value.to_string(), payload: None }
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self { message: value.to_string(), payload: None }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        // Port of friendlyError(): the same three constraint families surface
        // as the exact sentences the interface has always shown.
        let text = value.to_string();
        if text.contains("UNIQUE constraint failed") && text.contains("branches.code") {
            return Self::new("That name, Branch Code, Warehouse Code, or device identity already exists");
        }
        if text.contains("UNIQUE constraint failed") && text.contains("branches.warehouse_code") {
            return Self::new("That name, Branch Code, Warehouse Code, or device identity already exists");
        }
        if text.contains("UNIQUE constraint failed") && text.contains("users.username") {
            return Self::new("That username is already in use");
        }
        if text.contains("UNIQUE constraint failed") && text.contains("credentials.name") {
            return Self::new("That name, Branch Code, Warehouse Code, or device identity already exists");
        }
        if text.contains("UNIQUE constraint failed") && text.contains("devices") && text.contains("branch_id") {
            return Self::new("Only one Router can be defined for each branch");
        }
        if text.contains("UNIQUE constraint failed") {
            return Self::new("That name, Branch Code, Warehouse Code, or device identity already exists");
        }
        if text.contains("FOREIGN KEY constraint failed") {
            return Self::new("The selected related record no longer exists");
        }
        // The database-level Router invariant surfaces as RAISE(ABORT, ...).
        if text.contains("Only one Router") {
            return Self::new("Only one Router can be defined for each branch");
        }
        Self { message: text, payload: None }
    }
}

pub type AppResult<T> = Result<T, AppError>;
