# HyperFamily Branch Monitor — Tauri Edition

Secure Windows desktop monitoring and inventory application for HyperFamily retail
branches — the same application as `hyperfamily-it-app`, rebuilt on **Tauri 2 + Rust**
so the installer shrinks from ~180 MB (Electron) to a small NSIS package with no
Node runtime inside.

Everything the Electron app did is here with **100 % feature parity**: encrypted
database, credential vault, live ping monitoring, the directory import/export
workbooks, the in-app SSH/Telnet terminal, RDP / TeamViewer / Winbox / browser
launchers, themed iLO & NVR device windows, FortiClient VPN integration, the
in-app updater, and the whole Update Store App toolkit (version sweeps, native
agent imports, verified deployments).

---

## Repository layout

```
app/  components/  stores/  lib/  public/   ← Next.js frontend (unchanged from the Electron app)
src-tauri/                                  ← the Rust application
  src/main.rs                               ← entry point
  src/lib.rs                                ← plugins, state, background loops, channel wiring
  src/db/                                   ← SQLCipher database + migrations
  src/services/                             ← ports of every electron/services/*.js module
  src/commands/                             ← the ~65 IPC channels (same names as Electron)
  tauri.conf.json                           ← window, bundle, updater configuration
  capabilities/default.json                 ← main-window permissions only
agent/                                      ← native C++ store agent (UNCHANGED, built by CI/scripts)
scripts/build-agent.ps1                     ← agent build + staging for the bundle
.github/workflows/build.yml                 ← Windows CI: build → installer → release feed
recovery/                                   ← recovery tool assets (see "Credential recovery")
docs/                                       ← port matrix and implementation notes
```

The frontend is the SAME code the Electron app shipped. The only touch point is
`app/layout.js`, which defines `window.hyperfamily` — a byte-for-byte replacement
of `electron/preload/index.js` backed by Tauri IPC. Every channel name
(`auth:login`, `store-update:deploy`, …) is identical.

## Development

Requirements: **Windows 10/11**, Node ≥ 22.12, Rust (MSVC), CMake + VS C++ Build
Tools (for the agent), WebView2 Runtime (preinstalled on updated Windows).

```powershell
npm ci
npm run dev:tauri          # Next dev server + Tauri window
npm run build:tauri        # release installer in src-tauri/target/release/bundle/nsis/
```

The native agent (bundled resource) is built first in CI; locally run
`powershell -File scripts/build-agent.ps1` once before `build:tauri`.

## Releases & the in-app updater

The updater feed is **this repository's GitHub releases**:

1. Generate the minisign keypair once:
   ```powershell
   npm run tauri signer generate -- -w ~/.tauri/hyperfamily.key
   ```
2. Put the private key in the repository secrets as `TAURI_SIGNING_PRIVATE_KEY`
   (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you set one).
3. Paste the contents of `~/.tauri/hyperfamily.key.pub` into
   `src-tauri/tauri.conf.json → plugins.updater.pubkey` (replace the placeholder).
4. Push a tag `v3.0.1`. CI builds the NSIS installer, signs the updater artifact,
   and attaches `latest.json` — the app then detects and installs updates itself.

Update UX is identical to the Electron build: check / download with live
progress / **pause cancels the download and keeps the numbers** / resume restarts
the download / stop / install (restart).

## Security model (unchanged)

- SQLCipher database (`PRAGMA key = x'…'`), key protected by Windows **DPAPI**
  in `.database-key` under the user profile.
- Credential vault: AES-256-GCM with a DPAPI-wrapped raw 32-byte key
  (`.vault-key`); payloads carry `aes:<iv>:<tag>:<ct>` markers.
- Recovery gate: `credentials.dat` v2 with a scrypt PIN hash
  (`scrypt:<salthex>:<hashhex>`, N=2^14, r=8, p=1), five attempts → five-minute
  lockout, shared between the app and the recovery flow.
- Device webviews (iLO/NVR) get their own persistent profile and accept
  self-signed certificates **for those windows only**; the main window keeps
  normal verification and is the only window with IPC capabilities.
- The Store agent service (`HyperFamilyStoreAgent`) is installed as
  `LocalService`, its directories get hardened ACLs, and the manager refuses to
  touch services whose binary path is not `C:\Agent\HyperFamilyStoreAgent.exe`.

## Credential recovery

The Electron repo shipped a tiny standalone Electron tool that read
`credentials.dat` after the recovery PIN was entered. The Tauri edition keeps
the same gate and the same file (`credentials.dat`, DPAPI, scrypt — see
`src/db/mod.rs`) and exposes it through the in-app recovery dialog on the login
screen (`auth:recover-status` / `auth:recover`), so the separate tool is no
longer needed on the machine.

## Fresh database

This edition creates a NEW encrypted database on first run. Existing Electron
installations are not migrated in place — the same SQLCipher + DPAPI approach is
used, so a future import path stays possible, but the first launch of the Tauri
app starts clean (default Admin account, default settings, six starter
snippets), exactly like a fresh Electron install.

## Port notes

`docs/PORT-NOTES.md` lists every Electron service → Rust module mapping and the
few deliberate simplifications (no differential updater — the Tauri updater
replaces it; pause = cancel; single-window session instead of per-window
sessions).
