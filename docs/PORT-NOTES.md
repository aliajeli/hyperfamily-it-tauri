# Port notes — electron/services → src-tauri/src/services

Every module of `electron/services/*.js` (19 files) has a Rust counterpart.
Channel names, event payloads, error sentences and audit actions are preserved
so the frontend and operational habits stay identical.

| Electron (JS)                          | Tauri (Rust)                                   | Notes |
| -------------------------------------- | ---------------------------------------------- | ----- |
| crypto.service.js                      | services/vault.rs                              | AES-256-GCM with RAW 32-byte key (Node `createCipheriv` compatibility), DPAPI wrap, scrypt PIN hashing |
| database/ (SQLCipher)                  | db/mod.rs + db/migrations.rs                   | Same schema/migrations, same audit actions, same friendly error mapping |
| ping.service.js                        | services/ping.rs + lib.rs loop                 | First tick 250 ms, interval `ping_interval`, error → 5 s |
| reachability.service.js                | services/reachability.rs                       | ICMP + SMB(445) ladder, identical result shape |
| smb.service.js                         | services/smb.rs                                | `net use` session manager with refcounting; failed sign-ins are never cached |
| registry.service.js / wmi-registry.js  | services/registry.rs                           | Programs and Features (uninstall keys + MSI + WMI fallback), pick logic |
| software.service.js                    | services/software.rs                           | Installed list cache, PS helpers, streamed copy with progress + SHA-256 |
| terminal.service.js                    | services/terminal.rs                           | ssh2 (libssh2) with the SAME legacy algorithm lists, telnet IAC negotiation + autologin prompts, max 12 sessions |
| vpn.service.js                         | services/vpn.rs + services/portal.rs           | Global/FortiClient mode only; adapter+baseline tunnel detection; 1 s health; portal TLS ladder (5 profiles) for diagnostics with lenient HTTP parsing |
| remote.service.js                      | services/remote.rs                             | RDP via cmdkey+mstsc, TeamViewer LAN `-i ip`, Winbox default 8291, browser; iLO/NVR → device_webview |
| main/webview-window.js + autologin.js  | services/device_webview.rs                     | Themed windows, injected login script (native setters + events), palette broadcast, persistent cookie profile |
| excel.service.js                       | services/excel.rs (umya-spreadsheet)           | Same sheets/validations/freeze/filter/styling; strict atomic import incl. legacy `Devices` layout |
| update.service.js                      | services/update.rs (+ tauri-plugin-updater)    | Feed = THIS repo's releases; pause cancels + keeps numbers; signature errors surface verbatim |
| store-update.service.js                | services/store_update.rs                       | Version sweep (pool 5, order-preserving, per-checkout events), Jalali backup stamping, copy→SHA-256 verify with 3 delete-retry attempts |
| store-agent.service.js                 | services/store_agent.rs                        | Snapshot validation, \\host\C$\Agent mapping, import pipeline with rollback |
| agent-transfer.service.js              | services/agent_transfer.rs                     | 120 s idle / 30 min max deadlines, 1 MB buffer, throttled progress |
| agent-control.service.js               | services/agent_control.rs                      | sc.exe control, ownership assertion (binPath regex), directory ACL hardening |
| version.js                             | inline in update.rs (`compare_versions`)       | Numeric segment comparison |
| electron/recovery (standalone tool)    | in-app dialog (auth:recover-*) over db layer   | Same credentials.dat v2 gate; separate tool retired |

## Deliberate simplifications

1. **Updater**: the Electron differential updater is replaced by the
   signature-verified Tauri updater. Pause still cancels the download (numbers
   stay on screen); resume restarts from zero — same behaviour the Electron
   build had.
2. **Sessions**: one desktop session instead of one per BrowserWindow — the app
   has exactly one main window.
3. **Standalone recovery tool**: replaced by the in-app recovery dialog; the
   encrypted `credentials.dat` v2 file and lockout logic are byte-compatible.
4. **Excel**: ExcelJS → umya-spreadsheet (pure Rust). Header styles, freeze
   panes, autofilter, dropdown/whole-number validations and zebra stripes are
   reproduced; formula-result cells are read as their cached string.

## IPC surface

`src/commands/` registers every channel with its ORIGINAL name via
`#[tauri::command(rename = "...")]`:

auth (10) · branches (4) · devices (3) · monitor (1) · settings (2) ·
credentials (11) · inventory (2) · directory (2) · remote (2) · remote:palette ·
terminal (5) · snippets (3) · notes (3) · vpn (5) · update (7) · store-update (8)
· audit (1) · dialog (3) · app (2).

Push events (same names as Electron): `monitor:update`, `terminal:data`,
`terminal:status`, `vpn:status`, `update:event`, `store-update:version`,
`store-update:step`, `store-update:progress`, `store-update:finished`,
`store-update:agent-step`, `agent-transfer:progress`,
`software:copy-progress`.
