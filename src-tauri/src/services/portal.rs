//! The FortiGate portal diagnostics engine: walks a TLS ladder (from strict
//! to per-legacy) until a handshake succeeds, then performs a lenient HTTP
//! read of `/remote/logincheck` — tolerant of the slightly malformed chunked
//! bodies real FortiGates emit (the `insecureHTTPParser` behaviour of the
//! original build).
//!
//! Only used by Settings → VPN "Test & diagnose"; the main Global mode never
//! needs TLS because the sign-in happens inside FortiClient itself.

use serde_json::{json, Value};

/// Handshake retry ladder, from strictest to most permissive. Rungs mirror
/// TLS_PROFILES in the Electron service (OpenSSL cipher-string syntax).
const TLS_PROFILES: [TlsProfile; 5] = [
    TlsProfile { min_version: None, ciphers: None, curves: None },
    TlsProfile { min_version: Some(openssl::ssl::SslVersion::TLS1_2), ciphers: None, curves: Some("auto") },
    TlsProfile {
        min_version: Some(openssl::ssl::SslVersion::TLS1),
        ciphers: Some("DEFAULT"),
        curves: Some("auto"),
    },
    TlsProfile {
        min_version: Some(openssl::ssl::SslVersion::TLS1),
        ciphers: Some("ALL"),
        curves: Some("P-521:P-384:P-256"),
    },
    TlsProfile {
        min_version: Some(openssl::ssl::SslVersion::TLS1),
        ciphers: Some("AES128-SHA:AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:DES-CBC3-SHA:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA"),
        curves: Some("P-521:P-384:P-256"),
    },
];

struct TlsProfile {
    min_version: Option<openssl::ssl::SslVersion>,
    ciphers: Option<&'static str>,
    curves: Option<&'static str>,
}

fn is_handshake_failure(message: &str) -> bool {
    let pattern = regex::Regex::new(
        r"(?i)EPROTO|ERR_SSL|SSL routines|RSA routines|FIRST_OCTET_INVALID|wrong version number|no ciphers|unsupported protocol|handshake|DECRYPTION_FAILED|sslv3 alert",
    )
    .expect("static regex");
    pattern.is_match(message)
}

struct RawReply {
    status_code: u16,
    status_message: String,
    headers: Vec<(String, String)>,
    body: String,
}

/// Performs one portal request over the lenient parser.
pub async fn portal_request(gateway: &str, port: u16, username: &str, password: &str) -> Result<Value, String> {
    let body = format!(
        "ajax=1&username={}&credential={}&realm=",
        urlencode(username),
        urlencode(password)
    );
    let start = 0usize;
    let mut order: Vec<usize> = (start..TLS_PROFILES.len()).collect();
    order.extend(0..start);
    order.dedup();

    let mut last_error = String::new();
    for index in order {
        match portal_request_with(gateway, port, &body, &TLS_PROFILES[index]).await {
            Ok(reply) => return Ok(format_reply(reply)),
            Err(error) => {
                // Only a handshake failure justifies trying weaker crypto; a
                // refused login or an unreachable host must surface immediately.
                if !is_handshake_failure(&error) {
                    return Err(error);
                }
                last_error = error;
            }
        }
    }
    Err(last_error)
}

fn urlencode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

async fn portal_request_with(gateway: &str, port: u16, body: &str, profile: &TlsProfile) -> Result<RawReply, String> {
    // Owned copies: the blocking task must not borrow function locals.
    let owned = OwnedProfile {
        min_version: profile.min_version,
        ciphers: profile.ciphers.map(String::from),
    };
    let gateway = gateway.to_string();
    let body = body.to_string();
    tokio::task::spawn_blocking(move || -> Result<RawReply, String> {
        use std::io::Write;
        use std::net::TcpStream;

        let tcp = TcpStream::connect((gateway.as_str(), port))
            .map_err(|error| format!("Unable to reach the VPN gateway: {error}"))?;
        tcp.set_read_timeout(Some(std::time::Duration::from_secs(20))).ok();
        tcp.set_write_timeout(Some(std::time::Duration::from_secs(20))).ok();

        let connector = build_connector(&owned)?;
        let mut tls = connector
            .connect(&gateway, tcp)
            .map_err(|error| format!("handshake failed with {gateway}: {error}"))?;

        let request = format!(
            "POST /remote/logincheck HTTP/1.1\r\nHost: {gateway}:{port}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\nUser-Agent: HyperFamily-Branch-Monitor\r\nAccept: */*\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        tls.write_all(request.as_bytes())
            .map_err(|error| format!("Unable to reach the VPN gateway: {error}"))?;

        read_lenient_response(&mut tls)
    })
    .await
    .map_err(|error| format!("portal task failed: {error}"))?
}

/// Owned, Send profile data handed to the blocking task.
struct OwnedProfile {
    min_version: Option<openssl::ssl::SslVersion>,
    ciphers: Option<String>,
}

fn build_connector(profile: &OwnedProfile) -> Result<openssl::ssl::SslConnector, String> {
    let mut builder = openssl::ssl::SslConnector::builder(openssl::ssl::SslMethod::tls())
        .map_err(|error| error.to_string())?;
    // The appliance certificate is never inspected for this diagnostic; the
    // login verdict comes from the portal reply itself.
    builder.set_verify(openssl::ssl::SslVerifyMode::NONE);
    if let Some(min_version) = profile.min_version {
        builder.set_min_proto_version(Some(min_version)).map_err(|error| error.to_string())?;
    }
    if let Some(ciphers) = &profile.ciphers {
        builder.set_cipher_list(ciphers).map_err(|error| format!("{error} (cipher list: {ciphers})"))?;
    }
    Ok(builder.build())
}

/// Reads an HTTP/1.1 response tolerantly: headers are parsed strictly enough
/// to be useful, the body is drained best-effort even when the chunk framing
/// is malformed (exactly what `insecureHTTPParser` bought the original).
fn read_lenient_response(stream: &mut openssl::ssl::SslStream<std::net::TcpStream>) -> Result<RawReply, String> {
    use std::io::Read;
    let mut buffer: Vec<u8> = Vec::with_capacity(16 * 1024);
    let mut chunk = [0u8; 8192];
    let header_end;
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => {
                header_end = buffer.len();
                break;
            }
            Ok(read) => {
                buffer.extend_from_slice(&chunk[..read]);
                if let Some(position) = find_header_end(&buffer) {
                    header_end = position;
                    break;
                }
                if buffer.len() > 1024 * 1024 {
                    return Err("The VPN gateway sent an oversized response header".into());
                }
            }
            Err(error) => return Err(format!("Unable to reach the VPN gateway: {error}")),
        }
    }
    let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = header_text.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let mut status_parts = status_line.splitn(3, ' ');
    let _http = status_parts.next().unwrap_or("");
    let status_code: u16 = status_parts.next().and_then(|code| code.parse().ok()).unwrap_or(0);
    let status_message = status_parts.next().unwrap_or("").to_string();

    let mut headers: Vec<(String, String)> = Vec::new();
    for line in lines {
        if let Some(separator) = line.find(':') {
            headers.push((line[..separator].trim().to_string(), line[separator + 1..].trim().to_string()));
        }
    }

    // Body: drain whatever remains plus whatever still arrives, best-effort.
    let mut body_bytes: Vec<u8> = buffer[header_end..].to_vec();
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => body_bytes.extend_from_slice(&chunk[..read]),
            Err(_) => break,
        }
    }
    let body = decode_body(&body_bytes);

    Ok(RawReply { status_code, status_message, headers, body })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n").map(|position| position + 4)
}

/// Lenient body decoding: honours valid chunk framing, falls back to the raw
/// bytes when the framing is broken (stray bytes around chunk-size lines).
fn decode_body(raw: &[u8]) -> String {
    let mut body: Vec<u8> = Vec::with_capacity(raw.len());
    let mut position = 0usize;
    let mut chunked = false;
    // Detect chunked framing from the first line if it looks like a size.
    while position < raw.len() {
        let line_end = match find_crlf(&raw[position..]) {
            Some(offset) => position + offset,
            None => break,
        };
        let line = String::from_utf8_lossy(&raw[position..line_end]).to_string();
        let size_text = line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16);
        match size {
            Ok(size) => {
                chunked = true;
                position = line_end + 2;
                if size == 0 {
                    break;
                }
                let end = std::cmp::min(position + size, raw.len());
                body.extend_from_slice(&raw[position..end]);
                position = end;
                // Skip the trailing CRLF when present.
                if raw.get(position) == Some(&b'\r') {
                    position += 2;
                }
            }
            Err(_) => {
                // Malformed framing: keep everything from here (the gateway
                // answer still matters more than its framing discipline).
                body.extend_from_slice(&raw[position..]);
                position = raw.len();
                break;
            }
        }
    }
    if !chunked && body.is_empty() {
        body.extend_from_slice(raw);
    }
    String::from_utf8_lossy(&body).to_string()
}

fn find_crlf(buffer: &[u8]) -> Option<usize> {
    buffer.windows(2).position(|window| window == b"\r\n")
}

fn format_reply(reply: RawReply) -> Value {
    let set_cookie: Vec<Value> = reply
        .headers
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("set-cookie"))
        .map(|(_, value)| json!(value))
        .collect();
    let cookies: Vec<Value> = set_cookie
        .iter()
        .filter_map(|item| item.as_str())
        .map(|item| item.split(';').next().unwrap_or("").to_string())
        .filter(|cookie| cookie.split_once('=').map(|(_, value)| !value.trim().is_empty()).unwrap_or(false))
        .map(|item| json!(item))
        .collect();
    let cookie = cookies
        .iter()
        .filter_map(|item| item.as_str())
        .find(|cookie| cookie.starts_with("SVPNCOOKIE="))
        .map(String::from)
        .unwrap_or_default();
    let headers: Value = {
        let mut map = serde_json::Map::new();
        for (name, value) in &reply.headers {
            map.insert(name.to_lowercase(), json!(value));
        }
        Value::Object(map)
    };
    json!({
        "statusCode": reply.status_code,
        "statusMessage": reply.status_message,
        "headers": headers,
        "setCookie": set_cookie,
        "cookies": cookies,
        "cookie": cookie,
        "body": reply.body,
        "transportError": ""
    })
}
