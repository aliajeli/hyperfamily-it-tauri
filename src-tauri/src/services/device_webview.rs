//! Port of electron/main/webview-window.js — themed windows that host device
//! web UIs (iLO, NVR) with the assigned credential injected into the login
//! form, persistent session cookies across re-opens, self-signed certificates
//! accepted for guest pages only, and live palette (theme) broadcasts.

use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};

pub struct DeviceWindowRegistry {
    pub windows: Mutex<HashMap<String, DeviceWindowMeta>>,
}

pub struct DeviceWindowMeta {
    pub window: WebviewWindow,
    pub username: String,
    pub password: String,
    pub kind: String,
    pub palette: Value,
}

pub fn registry() -> &'static DeviceWindowRegistry {
    static REGISTRY: once_cell::sync::OnceCell<DeviceWindowRegistry> = once_cell::sync::OnceCell::new();
    REGISTRY.get_or_init(|| DeviceWindowRegistry { windows: Mutex::new(HashMap::new()) })
}

pub fn palette_css(palette: &Value) -> String {
    let Value::Object(entries) = palette else { return String::new() };
    let pattern = regex::Regex::new(r"^[\d\s.,]+$").expect("static regex");
    entries
        .iter()
        .filter(|(_, value)| value.as_str().map(|text| pattern.is_match(text)).unwrap_or(false))
        .map(|(key, value)| format!("--{key}: {}; ", value.as_str().unwrap_or("")))
        .collect()
}

/// Guest pages keep their own look, but the scrollbars and form controls are
/// tinted so the embedded UI does not clash with the application shell.
pub fn guest_theme_css(palette: &Value) -> String {
    let surface = palette.get("surface").and_then(Value::as_str).unwrap_or("24 27 34");
    let border = palette.get("border").and_then(Value::as_str).unwrap_or("44 48 58");
    let primary = palette.get("primary").and_then(Value::as_str).unwrap_or("96 165 250");
    format!(
        r#"
    ::-webkit-scrollbar {{ width: 11px; height: 11px; }}
    ::-webkit-scrollbar-track {{ background: rgb({surface}); }}
    ::-webkit-scrollbar-thumb {{ background: rgb({border}); border-radius: 8px; border: 2px solid rgb({surface}); }}
    ::-webkit-scrollbar-thumb:hover {{ background: rgb({primary}); }}
    :focus-visible {{ outline: 2px solid rgb({primary}) !important; outline-offset: 1px; }}
    ::selection {{ background: rgb({primary} / .35); }}
  "#
    )
}

/// Builds the script injected into an appliance login page. Port of
/// electron/main/autologin.js (buildLoginScript) — waits for the fields to
/// exist, writes through the native value setter (React/Angular listen to the
/// resulting input event), and submits. Gives up quietly after 12 seconds.
pub fn build_login_script(username: &str, password: &str, kind: &str) -> String {
    let payload = json!({ "username": username, "password": password, "kind": kind }).to_string();
    format!(
        r#"(() => {{
  const CREDENTIAL = {payload};
  if (window.__hyperfamilyAutologin) return 'already-running';
  window.__hyperfamilyAutologin = true;

  const USER_SELECTORS = [
    'input[name="username" i]', 'input[id="username" i]', 'input[name="user" i]', 'input[id="user" i]',
    'input[name="userid" i]', 'input[id="userid" i]', 'input[name="loginname" i]', 'input[id="loginName" i]',
    'input[name="account" i]', 'input[autocomplete="username"]', 'input[type="email"]',
    'input[placeholder*="user" i]', 'input[aria-label*="user" i]', 'input[name*="user" i]', 'input[id*="user" i]'
  ];
  const PASS_SELECTORS = ['input[type="password"]', 'input[name*="pass" i]', 'input[id*="pass" i]'];

  const visible = (el) => !!el && !el.disabled && !el.readOnly && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);

  const pick = (selectors, root) => {{
    for (const selector of selectors) {{
      const found = [...root.querySelectorAll(selector)].find(visible);
      if (found) return found;
    }}
    return null;
  }};

  const roots = () => {{
    const list = [document];
    for (const frame of document.querySelectorAll('iframe, frame')) {{
      try {{ if (frame.contentDocument) list.push(frame.contentDocument); }} catch (error) {{ void error; }}
    }}
    return list;
  }};

  const setValue = (input, value) => {{
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    input.focus();
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', {{ bubbles: true }}));
    input.dispatchEvent(new Event('change', {{ bubbles: true }}));
    input.dispatchEvent(new KeyboardEvent('keyup', {{ bubbles: true, key: 'a' }}));
  }};

  const submit = (passwordField, root) => {{
    const form = passwordField.form;
    const button = (form || root).querySelector(
      'button[type="submit"], input[type="submit"], button[id*="login" i], button[name*="login" i], ' +
      'button[class*="login" i], a[id*="login" i], button[id*="signin" i], button[class*="submit" i]'
    );
    if (button && visible(button)) {{ button.click(); return 'button'; }}
    if (form) {{
      if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit();
      return 'form';
    }}
    passwordField.dispatchEvent(new KeyboardEvent('keydown', {{ bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }}));
    return 'enter';
  }};

  const attempt = () => {{
    for (const root of roots()) {{
      const passwordField = pick(PASS_SELECTORS, root);
      if (!passwordField) continue;
      const userField = pick(USER_SELECTORS, root) || pick(['input[type="text"]'], root);
      if (userField) setValue(userField, CREDENTIAL.username);
      setValue(passwordField, CREDENTIAL.password);
      setTimeout(() => {{
        let how = 'none';
        try {{ how = submit(passwordField, root); }} catch (error) {{ void error; }}
        window.__hyperfamilyAutologin = false;
      }}, 160);
      return true;
    }}
    if (Date.now() > (window.__hyperfamilyDeadline || 0)) {{ window.__hyperfamilyAutologin = false; return true; }}
    return false;
  }};

  window.__hyperfamilyDeadline = Date.now() + 12000;
  if (attempt()) return 'started';
  const timer = setInterval(() => {{ if (attempt()) clearInterval(timer); }}, 350);
}})()"#
    )
}

/// Builds the scripts the guest window runs on every navigation: the theme
/// CSS injection plus (when enabled) the credential auto-login.
fn guest_scripts(username: &str, password: &str, kind: &str, palette: &Value, autologin: bool) -> Vec<String> {
    let css = guest_theme_css(palette).replace('\n', " ");
    let theme_script = format!(
        r#"(() => {{
  const apply = () => {{
    if (document.getElementById('hyperfamily-guest-theme')) return;
    const style = document.createElement('style');
    style.id = 'hyperfamily-guest-theme';
    style.textContent = `{css}`;
    (document.head || document.documentElement).appendChild(style);
  }};
  apply();
  document.addEventListener('DOMContentLoaded', apply);
}})()"#
    );
    let mut scripts = vec![theme_script];
    if autologin {
        scripts.push(build_login_script(username, password, kind));
    }
    scripts
}

/// Opens (or focuses) a themed shell window hosting the device UI.
#[allow(clippy::too_many_arguments)]
pub fn open_device_webview(
    app: &AppHandle,
    device_id: Value,
    title: &str,
    kind: &str,
    url: &str,
    username: &str,
    password: &str,
    palette: Value,
    autologin: bool,
) -> Result<Value, String> {
    let key = format!("{kind}:{device_id}");
    let existing = registry().windows.lock().get(&key).map(|meta| meta.window.clone());
    if let Some(existing) = existing {
        let _ = existing.set_focus();
        return Ok(json!({ "success": true, "reused": true }));
    }

    let label = format!("device-{}", key.replace(':', "-"));
    // A shared, persistent cookie store for every device window (the
    // Electron build used the `persist:hyperfamily-devices` partition).
    let data_directory = app
        .path()
        .app_data_dir()
        .map(|path| path.join("devices-webview"))
        .map_err(|error| error.to_string())?;
    let _ = std::fs::create_dir_all(&data_directory);

    // Appliance web UIs almost always ship a self-signed certificate.
    // Accepting it here is scoped to this window's environment only; the main
    // window keeps full certificate verification.
    let scripts = guest_scripts(username, password, kind, &palette, autologin);
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url.parse().map_err(|error| format!("invalid device URL: {error}"))?))
        .title(title)
        .inner_size(1360.0, 900.0)
        .min_inner_size(720.0, 520.0)
        .visible(false)
        .data_directory(data_directory);
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args("--ignore-certificate-errors --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection");
    }
    for script in scripts {
        builder = builder.initialization_script(&script);
    }
    let window = builder.build().map_err(|error| error.to_string())?;
    let window_clone = window.clone();
    let app_clone = app.clone();
    let key_clone = key.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let _ = window_clone.show();
        let _ = window_clone.set_focus();
        let _ = app_clone; // keep the handle alive for the window's lifetime bookkeeping
    });
    registry().windows.lock().insert(
        key,
        DeviceWindowMeta { window, username: username.to_string(), password: password.to_string(), kind: kind.to_string(), palette },
    );
    Ok(json!({ "success": true, "reused": false }))
}

/// Pushes a live theme change into every open device window.
pub fn broadcast_palette(palette: &Value) {
    let css = palette_css(palette);
    let mut windows = registry().windows.lock();
    let script = format!(
        r#"(() => {{
  const palette = {palette};
  const css = `{css}`;
  let style = document.getElementById('hyperfamily-guest-theme');
  if (!style) {{
    style = document.createElement('style');
    style.id = 'hyperfamily-guest-theme';
    (document.head || document.documentElement).appendChild(style);
  }}
  style.textContent = css;
  window.dispatchEvent(new CustomEvent('hyperfamily-device-palette', {{ detail: palette }}));
}})()"#,
        palette = palette.to_string(),
        css = css
    );
    for meta in windows.values_mut() {
        meta.palette = palette.clone();
        let _ = meta.window.eval(&script);
    }
}

/// Closes a device window by its key (kind:deviceId).
pub fn close_device_webview(kind: &str, device_id: &Value) -> bool {
    let key = format!("{kind}:{device_id}");
    let removed = registry().windows.lock().remove(&key);
    if let Some(meta) = removed {
        let _ = meta.window.close();
        true
    } else {
        false
    }
}

pub type SharedRegistry = Arc<DeviceWindowRegistry>;
