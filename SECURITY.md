# Security Policy

## Supported versions

Security fixes are applied to the latest release line.

| Version | Supported |
| --- | --- |
| Latest stable release (3.0.x) | Yes |
| Older releases | Upgrade to the latest stable release |

## Reporting a vulnerability

Do not publish credentials, VPN profiles, IP inventories, database files, or exploit details in a public GitHub issue. Contact the HyperFamily IT owner privately, include the affected version and reproduction steps, and allow time for coordinated remediation.

Use the repository's private vulnerability-reporting option under **Security → Advisories** when available, or contact the HyperFamily IT owner through an established private organizational channel. Never include secrets in a public issue.

## Security model

- Renderer processes have `nodeIntegration: false` and `contextIsolation: true`; the main window currently uses `sandbox: false`.
- A narrow preload bridge exposes allow-listed IPC methods only.
- Privileged IPC requires an in-memory authenticated renderer session.
- External navigation is limited to HTTPS and `mailto:` links.
- Remote processes use argument arrays with `shell: false`.
- Device host input is validated before OS process launch.
- Administrator passwords use bcryptjs with cost 10.
- SQLite uses SQLCipher-compatible AES-256 encryption.
- The random database key is encrypted with Electron `safeStorage` (Windows DPAPI).
- Credential and VPN password fields receive a second encryption layer.
- RDP credentials are target-scoped in Windows Credential Manager.
- Sensitive values are excluded from audit logs.
- Current VPN operation uses the installed FortiClient system tunnel; older proxy/split-tunnel implementations are not current supported modes.

## Operational limitations

This is a local administrator tool, not a zero-trust remote-access broker. A process running as the same Windows user may observe renderer memory or command-line arguments used by third-party VPN/remote clients. Protect the workstation with disk encryption, endpoint protection, account lockout, and least privilege.

Code signing is required for a trusted production installer and updater chain. Signing depends on configured release secrets; `verifyUpdateCodeSignature` is currently disabled in the packaging configuration. Do not enable unattended update installation from unsigned releases.

## Secret handling

Never commit:

- `.db`, `.sqlite`, `.ovpn`, or VPN credential files
- real branch addresses or asset exports
- Authenticode private keys
- GitHub personal access tokens
- TeamViewer passwords

Rotate any secret that is accidentally disclosed.
