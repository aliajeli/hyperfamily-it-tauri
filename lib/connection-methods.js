/**
 * How each device type is connected to.
 *
 * A single source of truth shared by the device action menu (which offers the
 * methods) and Settings → Devices (which lets an administrator change them).
 * Keeping both on this module is what stops the two from drifting apart.
 *
 * Each device type owns an ORDERED list of methods. Order is meaningful: the
 * first entry is the default — the one used when a device is opened without
 * picking a method explicitly — and the rest are the alternatives offered
 * underneath it.
 */

/** Every connection method the application can perform. */
export const CONNECTION_METHODS = {
  winbox: {
    id: 'winbox',
    label: 'Winbox',
    description: 'MikroTik Winbox management console'
  },
  terminal: {
    id: 'terminal',
    label: 'Terminal',
    description: 'Built-in SSH / Telnet terminal inside the app'
  },
  webview: {
    id: 'webview',
    label: 'Browser with auto sign-in',
    description: 'Internal browser page that signs in automatically'
  },
  browser: {
    id: 'browser',
    label: 'External browser',
    description: 'Opens the device web interface in the system browser'
  },
  rdp: {
    id: 'rdp',
    label: 'Remote Desktop',
    description: 'Windows Remote Desktop (RDP) session'
  },
  teamviewer: {
    id: 'teamviewer',
    label: 'TeamViewer',
    description: 'TeamViewer LAN connection'
  }
}

export const CONNECTION_METHOD_IDS = Object.keys(CONNECTION_METHODS)

/**
 * Factory defaults, as specified for v2.0.10.
 *
 * Router / AccessPoint → Winbox
 * Switch               → internal Terminal
 * iLO / NVR            → browser page with automatic sign-in
 * Server / Checkout    → Remote Desktop
 * Client               → Remote Desktop, then TeamViewer
 */
export const DEFAULT_CONNECTION_METHODS = {
  Router: ['winbox', 'browser', 'terminal'],
  AccessPoint: ['winbox', 'browser', 'terminal'],
  Switch: ['terminal', 'browser'],
  iLO: ['webview', 'browser'],
  NVR: ['webview', 'browser'],
  Server: ['rdp', 'teamviewer', 'terminal'],
  Checkout: ['rdp', 'teamviewer'],
  Client: ['rdp', 'teamviewer'],
  Scale: ['browser', 'webview'],
  POS: ['teamviewer', 'browser']
}

/** The settings key holding the overrides for one device type. */
export function connectionSettingKey(deviceType) {
  return `connection_methods_${String(deviceType).toLowerCase()}`
}

/**
 * Resolves the ordered method list for a device type.
 *
 * Anything unusable is dropped rather than trusted: unknown ids (from an older
 * or newer build) and duplicates are filtered out, and an override that ends up
 * empty falls back to the factory default. A device type must never be left
 * with no way to connect just because a stored value went stale.
 */
export function resolveConnectionMethods(deviceType, settings = {}) {
  const fallback = DEFAULT_CONNECTION_METHODS[deviceType] || ['browser']
  const stored = settings?.[connectionSettingKey(deviceType)]
  if (!Array.isArray(stored)) return fallback

  const cleaned = stored
    .map((id) => String(id))
    .filter((id, index, all) => CONNECTION_METHODS[id] && all.indexOf(id) === index)

  return cleaned.length ? cleaned : fallback
}

/** The single method used when a device is opened without choosing one. */
export function defaultConnectionMethod(deviceType, settings = {}) {
  return resolveConnectionMethods(deviceType, settings)[0]
}
