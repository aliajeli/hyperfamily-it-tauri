//! Port of electron/services/terminal.service.js — in-app SSH and Telnet
//! sessions. SSH uses libssh2 (via the `ssh2` crate) with the exact same
//! permissive legacy algorithm lists as the Electron build, so the old
//! switches in the field keep connecting.

use crate::error::{AppError, AppResult};
use crate::services::Emitter;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

const SAFE_HOST: &str = r"^[a-zA-Z0-9.-]{1,253}$";
const MAX_SESSIONS: usize = 12;

// Telnet negotiation bytes.
const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;
const ECHO: u8 = 1;
const SUPPRESS_GO_AHEAD: u8 = 3;
const TERMINAL_TYPE: u8 = 24;
const NAWS: u8 = 31;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Transport {
    Ssh,
    Telnet,
}

pub enum SessionCommand {
    Write(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct TerminalSession {
    sender: std::sync::mpsc::Sender<SessionCommand>,
    transport: Transport,
}

pub struct TerminalService {
    database: Arc<crate::db::AppDatabase>,
    emitter: Emitter,
    sessions: parking_lot::Mutex<HashMap<String, TerminalSession>>,
    counter: parking_lot::Mutex<u64>,
}

fn resolve_transport(device: &Value) -> Transport {
    if device.get("transport").and_then(Value::as_str) == Some("telnet") {
        Transport::Telnet
    } else {
        Transport::Ssh
    }
}

impl TerminalService {
    pub fn new(database: Arc<crate::db::AppDatabase>, emitter: Emitter) -> Self {
        Self { database, emitter, sessions: parking_lot::Mutex::new(HashMap::new()), counter: parking_lot::Mutex::new(0) }
    }

    fn emit(&self, session_id: &str, channel: &str, payload: Value) {
        let mut event = json!({ "sessionId": session_id });
        if let (Value::Object(base), Value::Object(additions)) = (&mut event, &payload) {
            for (key, value) in additions {
                base.insert(key.clone(), value.clone());
            }
        }
        (self.emitter)(channel, event);
    }

    pub fn targets(&self) -> AppResult<Vec<Value>> {
        self.database.list_terminal_targets()
    }

    fn resolve(&self, device_id: i64) -> AppResult<(Value, Value, Transport, u64)> {
        let device = self.database.get_device(device_id)?.ok_or_else(|| AppError::new("Device not found"))?;
        if device.get("device_type").and_then(Value::as_str) != Some("Switch") {
            return Err(AppError::new("The in-app terminal is available for switches"));
        }
        let pattern = regex::Regex::new(SAFE_HOST).expect("static regex");
        let ip = device.get("ip").and_then(Value::as_str).unwrap_or("");
        if !pattern.is_match(ip) {
            return Err(AppError::new("Unsafe or invalid device address"));
        }
        let credential = self
            .database
            .resolve_device_credential(device_id)?
            .ok_or_else(|| AppError::new("Assign a credential to switches in Settings \u{2192} Credentials first"))?;
        let settings = self.database.get_settings().unwrap_or(json!({}));
        let transport = resolve_transport(&device);
        let fallback_port = match transport {
            Transport::Telnet => settings.get("terminal_telnet_port").and_then(Value::as_i64).unwrap_or(23),
            Transport::Ssh => settings.get("terminal_ssh_port").and_then(Value::as_i64).unwrap_or(22),
        };
        let port = device
            .get("connection_port")
            .and_then(Value::as_f64)
            .map(|value| value as u64)
            .or_else(|| device.get("port").and_then(Value::as_f64).map(|value| value as u64))
            .unwrap_or(fallback_port as u64);
        Ok((device, credential, transport, port))
    }

    pub fn open(&self, payload: &Value, actor: &str) -> AppResult<Value> {
        {
            let sessions = self.sessions.lock();
            if sessions.len() >= MAX_SESSIONS {
                return Err(AppError::new(format!("At most {MAX_SESSIONS} terminal sessions can be open at once")));
            }
        }
        let device_id = payload.get("deviceId").and_then(Value::as_f64).map(|value| value as i64).unwrap_or(0);
        let (device, credential, transport, port) = self.resolve(device_id)?;
        let session_id = {
            let mut counter = self.counter.lock();
            *counter += 1;
            format!("term-{counter}")
        };
        let cols = payload.get("cols").and_then(Value::as_f64).map(|value| value as u32).unwrap_or(80);
        let rows = payload.get("rows").and_then(Value::as_f64).map(|value| value as u32).unwrap_or(24);
        let name = device.get("name").and_then(Value::as_str).filter(|text| !text.is_empty()).map(String::from).unwrap_or_else(|| device.get("device_type").and_then(Value::as_str).unwrap_or("").to_string());
        let host = device.get("ip").and_then(Value::as_str).unwrap_or("").to_string();
        let username = credential.get("username").and_then(Value::as_str).unwrap_or("").to_string();
        let password = credential.get("password").and_then(Value::as_str).unwrap_or("").to_string();

        let target = format!("{name} ({host}:{port})");
        let transport_label = match transport {
            Transport::Ssh => "SSH",
            Transport::Telnet => "TELNET",
        };
        let credential_name = credential.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        self.database.audit(actor, &format!("{transport_label}_OPEN"), &target, &format!("Credential: {credential_name}"));

        let (sender, receiver) = std::sync::mpsc::channel::<SessionCommand>();
        self.sessions.lock().insert(session_id.clone(), TerminalSession { sender, transport });

        let emitter = self.emitter.clone();
        let session_id_for_worker = session_id.clone();
        let host_for_worker = host.clone();
        let username_for_worker = username.clone();
        let spawn_result = std::thread::Builder::new()
            .name(format!("terminal-{session_id}"))
            .spawn(move || match transport {
                Transport::Ssh => ssh_worker(
                    &session_id_for_worker,
                    &host_for_worker,
                    port,
                    &username_for_worker,
                    &password,
                    cols,
                    rows,
                    receiver,
                    emitter,
                ),
                Transport::Telnet => telnet_worker(
                    &session_id_for_worker,
                    &host_for_worker,
                    port,
                    &username_for_worker,
                    &password,
                    cols,
                    rows,
                    receiver,
                    emitter,
                ),
            });
        if let Err(error) = spawn_result {
            self.sessions.lock().remove(&session_id);
            return Err(AppError::new(format!("The terminal worker could not start: {error}")));
        }
        Ok(json!({ "sessionId": session_id, "transport": match transport { Transport::Ssh => "ssh", Transport::Telnet => "telnet" }, "host": host, "port": port, "name": name, "username": username }))
    }

    fn owned(&self, session_id: &str) -> AppResult<TerminalSession> {
        self.sessions
            .lock()
            .get(session_id)
            .map(|session| TerminalSession { sender: session.sender.clone(), transport: session.transport })
            .ok_or_else(|| AppError::new("That terminal session is no longer open"))
    }

    pub fn write(&self, session_id: &str, data: &str) -> AppResult<bool> {
        let session = self.owned(session_id)?;
        let _ = session.sender.send(SessionCommand::Write(data.as_bytes().to_vec()));
        Ok(true)
    }

    pub fn resize(&self, session_id: &str, cols: u32, rows: u32) -> AppResult<bool> {
        let session = self.owned(session_id)?;
        let _ = session.sender.send(SessionCommand::Resize(cols, rows));
        Ok(true)
    }

    pub fn close(&self, session_id: &str, reason: &str) -> AppResult<bool> {
        let session = self.owned(session_id).ok();
        if let Some(session) = session {
            let _ = session.sender.send(SessionCommand::Close);
        }
        let removed = self.sessions.lock().remove(session_id).is_some();
        if removed {
            self.emit(session_id, "terminal:status", json!({ "state": "closed", "message": reason }));
        }
        Ok(true)
    }

    pub fn stop(&self) {
        let ids: Vec<String> = self.sessions.lock().keys().cloned().collect();
        for id in ids {
            let _ = self.close(&id, "Application closing");
        }
    }
}

/// Answers every keyboard-interactive prompt with the stored password —
/// switches with `login:`/`Password:`-style challenges sign in unattended.
struct PasswordPrompter<'a> {
    password: &'a str,
}

impl<'a> ssh2::KeyboardInteractivePrompt for PasswordPrompter<'a> {
    fn prompt<'b>(&mut self, _username: &str, _instructions: &str, prompts: &[ssh2::Prompt<'b>]) -> Vec<String> {
        prompts.iter().map(|_| self.password.to_string()).collect()
    }
}

fn friendly_error(message: &str) -> String {
    if message.contains("ECONNREFUSED") {
        return "Connection refused \u{2014} the service is not listening on that port".into();
    }
    if message.contains("EHOSTUNREACH") || message.contains("ENETUNREACH") {
        return "The device is unreachable from this network".into();
    }
    if message.to_lowercase().contains("timed out") {
        return "The connection timed out".into();
    }
    if message.contains("All configured authentication methods failed") {
        return "Authentication failed \u{2014} check the credential assigned to switches".into();
    }
    message.to_string()
}

fn report_status(emitter: &Emitter, session_id: &str, state: &str, message: Option<&str>) {
    emitter("terminal:status", json!({ "sessionId": session_id, "state": state, "message": message.unwrap_or("") }));
}

fn report_data(emitter: &Emitter, session_id: &str, data: &[u8]) {
    emitter("terminal:data", json!({ "sessionId": session_id, "data": String::from_utf8_lossy(data) }));
}

/// Sets the exact same permissive preference lists as the Electron build so
/// the legacy switches in the field keep connecting.
fn configure_legacy_preferences(session: &ssh2::Session) {
    use ssh2::MethodType;
    let preferences: [(MethodType, &str); 6] = [
        (
            MethodType::Kex,
            "curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521,diffie-hellman-group-exchange-sha256,diffie-hellman-group14-sha256,diffie-hellman-group16-sha512,diffie-hellman-group14-sha1,diffie-hellman-group1-sha1,diffie-hellman-group-exchange-sha1",
        ),
        (
            MethodType::HostKey,
            "ssh-ed25519,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,ecdsa-sha2-nistp521,rsa-sha2-512,rsa-sha2-256,ssh-rsa,ssh-dss",
        ),
        (
            MethodType::CryptCs,
            "aes128-gcm@openssh.com,aes256-gcm@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr,aes128-cbc,aes192-cbc,aes256-cbc,3des-cbc",
        ),
        (
            MethodType::CryptSc,
            "aes128-gcm@openssh.com,aes256-gcm@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr,aes128-cbc,aes192-cbc,aes256-cbc,3des-cbc",
        ),
        (
            MethodType::MacCs,
            "hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com,hmac-sha2-256,hmac-sha2-512,hmac-sha1",
        ),
        (
            MethodType::MacSc,
            "hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com,hmac-sha2-256,hmac-sha2-512,hmac-sha1",
        ),
];
    for (kind, list) in preferences {
        // ssh2 0.9 takes the comma-separated preference list directly.
        let _ = session.method_pref(kind, list);
    }
}

#[allow(clippy::too_many_arguments)]
fn ssh_worker(
    session_id: &str,
    host: &str,
    port: u64,
    username: &str,
    password: &str,
    cols: u32,
    rows: u32,
    receiver: std::sync::mpsc::Receiver<SessionCommand>,
    emitter: Emitter,
) {
    let connect = || -> AppResult<(ssh2::Session, ssh2::Channel)> {
        let address = format!("{host}:{port}");
        let tcp = TcpStream::connect(&address).map_err(|error| AppError::new(friendly_error(&error.to_string())))?;
        let mut session = ssh2::Session::new().map_err(|error| AppError::new(error.to_string()))?;
        session.set_tcp_stream(tcp);
        session.set_timeout(15000);
        configure_legacy_preferences(&session);
        session.handshake().map_err(|error| AppError::new(friendly_error(&error.to_string())))?;
        if !session.authenticated() {
            // Password first, then keyboard-interactive (every prompt is
            // answered with the stored password, like the Electron build).
            if session.userauth_password(username, password).is_err() {
                let mut prompter = PasswordPrompter { password };
                session
                    .userauth_keyboard_interactive(username, &mut prompter)
                    .map_err(|_| AppError::new("Authentication failed \u{2014} check the credential assigned to switches"))?;
            }
        }
        if !session.authenticated() {
            return Err(AppError::new("Authentication failed \u{2014} check the credential assigned to switches"));
        }
        let mut channel = session.channel_session().map_err(|error| AppError::new(error.to_string()))?;
        channel
            .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
            .map_err(|error| AppError::new(error.to_string()))?;
        channel.shell().map_err(|error| AppError::new(error.to_string()))?;
        Ok((session, channel))
    };
    report_status(&emitter, session_id, "connecting", None);
    let (mut session, mut channel) = match connect() {
        Ok(pair) => {
            report_status(&emitter, session_id, "connected", None);
            pair
        }
        Err(error) => {
            report_status(&emitter, session_id, "error", Some(&error.message));
            drain_commands(&receiver);
            return;
        }
    };
    let _ = session.set_blocking(false);
    let _ = session.set_timeout(120);
    let mut buffer = [0u8; 16 * 1024];
    loop {
        // Incoming device output.
        match channel.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => report_data(&emitter, session_id, &buffer[..read]),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break,
        }
        // Operator commands, drained without blocking.
        match receiver.try_recv() {
            Ok(SessionCommand::Write(data)) => {
                if channel.write_all(&data).is_err() {
                    break;
                }
                let _ = channel.flush();
            }
            Ok(SessionCommand::Resize(new_cols, new_rows)) => {
                let _ = channel.request_pty_size(new_cols, new_rows, None, None);
            }
            Ok(SessionCommand::Close) | Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            Err(std::sync::mpsc::TryRecvError::Empty) => {}
        }
    }
    let _ = channel.close();
    let _ = session.disconnect(None, "closed", None);
    report_status(&emitter, session_id, "closed", Some("Session closed by the device"));
    drain_commands(&receiver);
}

/// Drains remaining commands so the sender never blocks on a dead worker.
fn drain_commands(receiver: &std::sync::mpsc::Receiver<SessionCommand>) {
    while let Ok(command) = receiver.try_recv() {
        if let SessionCommand::Close = command {
            break;
        }
    }
}

/// Answers Telnet option negotiation so the switch drops into character mode,
/// then returns the printable payload only. Port of negotiateTelnet.
fn negotiate_telnet(stream: &mut TcpStream, chunk: &[u8], state: &mut TelnetState) -> Vec<u8> {
    let mut output: Vec<u8> = Vec::new();
    let mut index = 0usize;
    while index < chunk.len() {
        if chunk[index] != IAC {
            output.push(chunk[index]);
            index += 1;
            continue;
        }
        let Some(&command) = chunk.get(index + 1) else { break };
        if command == IAC {
            output.push(IAC);
            index += 2;
            continue;
        }
        if command == SB {
            let mut end = index + 2;
            while end < chunk.len() && !(chunk[end] == IAC && chunk.get(end + 1) == Some(&SE)) {
                end += 1;
            }
            let option = chunk.get(index + 2).copied().unwrap_or(0);
            if option == TERMINAL_TYPE {
                let mut reply = vec![IAC, SB, TERMINAL_TYPE, 0];
                reply.extend_from_slice(b"xterm-256color");
                reply.extend_from_slice(&[IAC, SE]);
                let _ = stream.write_all(&reply);
            }
            index = end + 2;
            continue;
        }
        let Some(&option) = chunk.get(index + 2) else { break };
        let wants = matches!(option, TERMINAL_TYPE | NAWS | SUPPRESS_GO_AHEAD);
        if command == DO || command == DONT {
            let reply_will = command == DO && wants;
            let _ = stream.write_all(&[IAC, if reply_will { WILL } else { WONT }, option]);
            if command == DO && option == NAWS {
                let _ = stream.write_all(&[IAC, SB, NAWS, 0, (state.cols & 0xff) as u8, 0, (state.rows & 0xff) as u8, IAC, SE]);
            }
        } else if command == WILL || command == WONT {
            let wanted = matches!(option, ECHO | SUPPRESS_GO_AHEAD);
            let _ = stream.write_all(&[IAC, if command == WILL && wanted { DO } else { DONT }, option]);
        }
        index += 3;
    }
    output
}


struct TelnetState {
    cols: u32,
    rows: u32,
    sent_user: bool,
    sent_pass: bool,
    buffer: String,
}

#[allow(clippy::too_many_arguments)]
fn telnet_worker(
    session_id: &str,
    host: &str,
    port: u64,
    username: &str,
    password: &str,
    cols: u32,
    rows: u32,
    receiver: std::sync::mpsc::Receiver<SessionCommand>,
    emitter: Emitter,
) {
    let address = format!("{host}:{port}");
    let stream = TcpStream::connect(&address);
    let mut stream = match stream {
        Ok(stream) => {
            report_status(&emitter, session_id, "connected", None);
            stream
        }
        Err(error) => {
            report_status(&emitter, session_id, "error", Some(&friendly_error(&error.to_string())));
            drain_commands(&receiver);
            return;
        }
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(120)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_nodelay(true);
    let mut state = TelnetState { cols, rows, sent_user: false, sent_pass: false, buffer: String::new() };
    let mut buffer = [0u8; 16 * 1024];
    let user_prompt = regex::Regex::new(r"(user\s?name|login|user)\s*[:>]\s*$").expect("static regex");
    let pass_prompt = regex::Regex::new(r"password\s*[:>]\s*$").expect("static regex");
    let mut open = true;
    while open {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let clean = negotiate_telnet(&mut stream, &buffer[..read], &mut state);
                if !clean.is_empty() {
                    report_data(&emitter, session_id, &clean);
                    // Answer the classic login/password prompts once each.
                    let text = String::from_utf8_lossy(&clean);
                    state.buffer = format!("{}{}", state.buffer, text);
                    let length = state.buffer.len();
                    if length > 200 {
                        state.buffer = state.buffer[length - 200..].to_string();
                    }
                    let tail = state.buffer.to_lowercase();
                    if !state.sent_user && user_prompt.is_match(&tail) {
                        state.sent_user = true;
                        let _ = stream.write_all(format!("{username}\r\n").as_bytes());
                    } else if state.sent_user && !state.sent_pass && pass_prompt.is_match(&tail) {
                        state.sent_pass = true;
                        let _ = stream.write_all(format!("{password}\r\n").as_bytes());
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break,
        }
        match receiver.try_recv() {
            Ok(SessionCommand::Write(data)) => {
                if stream.write_all(&data).is_err() {
                    break;
                }
            }
            Ok(SessionCommand::Resize(new_cols, new_rows)) => {
                state.cols = new_cols;
                state.rows = new_rows;
                let _ = stream.write_all(&[IAC, SB, NAWS, 0, (new_cols & 0xff) as u8, 0, (new_rows & 0xff) as u8, IAC, SE]);
            }
            Ok(SessionCommand::Close) | Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                open = false;
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => {}
        }
    }
    let _ = stream.shutdown(std::net::Shutdown::Both);
    report_status(&emitter, session_id, "closed", Some("Session closed by the device"));
    drain_commands(&receiver);
}
