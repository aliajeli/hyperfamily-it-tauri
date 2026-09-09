'use client'

import bcrypt from 'bcryptjs'
import { APP_VERSION, DEFAULT_SETTINGS } from '@/lib/constants'
import { statusFromPing } from '@/lib/utils'

const STORE_KEY = 'hyperfamily.browser.demo.v2'
const AUTH_STORE_KEY = 'hyperfamily.browser.auth.v2'
const REMEMBER_KEY = 'hyperfamily.browser.remembered'
const MAX_SWITCH_PORTS = 48
// Kept in step with NOTE_COLORS in electron/database/index.js.
const NOTE_COLOR_NAMES = ['default', 'red', 'amber', 'green', 'blue', 'purple']

function normalizeSwitchPorts(ports, deviceId) {
  if (!Array.isArray(ports)) throw new Error('Switch ports must be provided as a list')
  if (ports.length > MAX_SWITCH_PORTS) throw new Error(`A Switch can contain at most ${MAX_SWITCH_PORTS} ports`)
  const seen = new Set()
  return ports.map((port, index) => {
    const portNumber = Number(port?.port_number)
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > MAX_SWITCH_PORTS) throw new Error(`Switch port ${index + 1} must use a Port Number from 1 through ${MAX_SWITCH_PORTS}`)
    if (seen.has(portNumber)) throw new Error(`Switch Port Number ${portNumber} is duplicated`)
    seen.add(portNumber)
    return { ...port, id: port.id || Date.now() + index, device_id: deviceId, port_number: portNumber }
  })
}

const seedBranches = [
  { id: 1, name: 'Central Berlin', code: 'BER-01', warehouse_code: 'WH-BER-01', manager_name: 'Sarah Klein', manager_tell: '+49 30 555 0101', deputy_name: 'Martin Vogel', deputy_tell: '+49 30 555 0102', link1: 'MPLS Primary', ip_link1: '10.10.1.1', link2: 'LTE Backup', ip_link2: '10.10.1.2' },
  { id: 2, name: 'Alexanderplatz', code: 'BER-02', warehouse_code: 'WH-BER-02', manager_name: 'Daniel Weber', manager_tell: '+49 30 555 0201', deputy_name: 'Emma Roth', deputy_tell: '+49 30 555 0202', link1: 'Fiber Primary', ip_link1: '10.20.1.1' },
  { id: 3, name: 'Potsdam', code: 'POT-01', warehouse_code: 'WH-POT-01', manager_name: 'Lena Fischer', manager_tell: '+49 331 555 0301', deputy_name: 'Noah Wolf', deputy_tell: '+49 331 555 0302', link1: 'MPLS Primary', ip_link1: '10.30.1.1' },
  { id: 4, name: 'Spandau', code: 'BER-03', warehouse_code: 'WH-BER-03', manager_name: 'Mia Wagner', manager_tell: '+49 30 555 0401', deputy_name: 'Leon Braun', deputy_tell: '+49 30 555 0402', link1: 'Fiber Primary', ip_link1: '10.40.1.1' }
]

const seedDevices = seedBranches.flatMap((branch, branchIndex) => {
  const templates = [
    { device_type: 'Router', name: `${branch.code} Gateway`, model: 'MikroTik CCR2004', location: 'Network room', connection_type: 'Winbox' },
    { device_type: 'iLO', name: 'iLO', model: 'HPE iLO 5', location: 'Server room', protocol: 'https' },
    { device_type: 'Server', name: 'Server - SQL', model: 'HPE ProLiant DL360', location: 'Server room', hostname: `${branch.code}-SQL`, port: 3389 },
    { device_type: 'Server', name: 'Server - IIS', model: 'HPE ProLiant DL360', location: 'Server room', hostname: `${branch.code}-IIS`, port: 3389 },
    ...Array.from({ length: 4 }, (_, index) => ({
      device_type: 'Checkout',
      name: `Checkout ${index + 1}`,
      model: 'HP Engage',
      location: `Checkout lane ${index + 1}`,
      hostname: `${branch.code}-CO-${index + 1}`,
      checkout_number: index + 1,
      port: 3389
    })),
    { device_type: 'Switch', name: 'Core Switch', model: 'Cisco CBS350', location: 'Network room', connection_type: 'Fiber', transport: 'ssh' },
    { device_type: 'Switch', name: 'Access Switch', model: 'Cisco CBS250', location: 'Sales floor', connection_type: 'Copper', transport: 'telnet' },
    { device_type: 'NVR', name: 'Security NVR', model: 'Hikvision DS-7616', location: 'Security rack' },
    { device_type: 'AccessPoint', name: 'Sales Floor AP', model: 'Aruba AP-515', location: 'Sales floor' },
    { device_type: 'POS', name: 'Payment terminal', model: 'Verifone', location: 'Checkout area', protocol: 'https', port: 443 }
  ]

  return templates.map((template, index) => ({
    id: branchIndex * 100 + index + 1,
    branch_id: branch.id,
    ip: `10.${(branchIndex + 1) * 10}.${index + 1}.${index + 10}`,
    asset_code: `HF-${branch.code}-${String(index + 1).padStart(3, '0')}`,
    is_dashboard_visible: index < 8 ? 1 : 0,
    created_at: new Date().toISOString(),
    ...template
  }))
})

/** Accepts the legacy `{ [deviceType]: [ids] }` shape and the unified one. */
function normalizeMappings(value) {
  if (!value || typeof value !== 'object') return { types: {}, devices: {} }
  if ('types' in value || 'devices' in value) {
    return { types: { ...(value.types || {}) }, devices: { ...(value.devices || {}) } }
  }
  return { types: { ...value }, devices: {} }
}

function initialState() {
  return {
    branches: seedBranches,
    devices: seedDevices,
    credentials: [],
    mappings: { types: {}, devices: {} },
    settings: { ...DEFAULT_SETTINGS },
    notes: [
      { id: 1, name: 'Branch rollout checklist', body: '1. Rack and label the switch\n2. Uplink to the router on Gi1/0/24\n3. Register the asset code in Inventory\n4. Verify ping from the dashboard', pinned: 1, color: 'blue', priority: 1, tags: ['network', 'rollout'], created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: 2, name: 'VLAN plan', body: 'VLAN 10 - Staff\nVLAN 20 - POS\nVLAN 30 - Cameras\nVLAN 99 - Management', pinned: 0, color: 'default', priority: 0, tags: ['vlan', 'network'], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    ],
    snippets: [
      { id: 1, name: 'Show interfaces', command: 'show interfaces status', description: 'Port status overview' },
      { id: 2, name: 'Show VLANs', command: 'show vlan brief', description: 'Configured VLANs and member ports' },
      { id: 3, name: 'Show MAC table', command: 'show mac address-table', description: 'Learned MAC addresses' },
      { id: 4, name: 'Show running config', command: 'show running-config', description: 'Active configuration' },
      { id: 5, name: 'Save config', command: 'write memory', description: 'Persist the running configuration' }
    ],
    audit: [{ id: 1, user: 'Admin', action: 'DEMO_STARTED', target: 'Browser preview', timestamp: new Date().toISOString() }]
  }
}

function normalizeBrowserState(value) {
  const baseline = initialState()
  const merged = { ...baseline, ...value, settings: { ...DEFAULT_SETTINGS, ...value?.settings } }
  const warehouseCodes = new Set()
  merged.branches = (Array.isArray(merged.branches) ? merged.branches : baseline.branches).map((branch, index) => {
    let warehouseCode = String(branch.warehouse_code || '').trim()
    if (!warehouseCode) warehouseCode = `LEGACY-${String(branch.code || branch.id || index + 1).trim()}`
    const base = warehouseCode
    let suffix = 2
    while (warehouseCodes.has(warehouseCode.toLowerCase())) warehouseCode = `${base}-${suffix++}`
    warehouseCodes.add(warehouseCode.toLowerCase())
    return { ...branch, warehouse_code: warehouseCode }
  })
  merged.devices = (Array.isArray(merged.devices) ? merged.devices : baseline.devices).map((device) => ({
    ...device,
    name: String(device.name || '').trim() || `${device.device_type || 'Device'} ${device.id}`
  }))
  return merged
}

function readState() {
  if (typeof window === 'undefined') return initialState()
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY))
    return value ? normalizeBrowserState(value) : initialState()
  } catch {
    return initialState()
  }
}

function writeState(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent('hyperfamily:data-changed'))
}

function withState(mutator) {
  const state = readState()
  const result = mutator(state)
  writeState(state)
  return result
}

async function hashBrowserPassword(password) {
  return bcrypt.hash(String(password || ''), 10)
}

async function readBrowserAccount() {
  try {
    const stored = JSON.parse(localStorage.getItem(AUTH_STORE_KEY))
    if (stored?.username && stored?.passwordHash) return stored
  } catch {}
  const account = { username: 'Admin', passwordHash: await hashBrowserPassword('Admin'), password: 'Admin' }
  writeBrowserAccount(account)
  return account
}

function writeBrowserAccount(account) {
  localStorage.setItem(AUTH_STORE_KEY, JSON.stringify(account))
}

async function updateBrowserCredentials(payload = {}) {
  const account = await readBrowserAccount()
  const currentPasswordMatches = await bcrypt.compare(String(payload.currentPassword || ''), account.passwordHash)
  if (!currentPasswordMatches) throw new Error('Current password is incorrect')

  const newUsername = String(payload.newUsername || '').trim()
  const newPassword = String(payload.newPassword || '')
  if (newUsername.length < 3 || newUsername.length > 64) throw new Error('Username must contain between 3 and 64 characters')
  if (newPassword && newPassword.length < 4) throw new Error('New password must contain at least 4 characters')

  const updated = {
    ...account,
    username: newUsername,
    passwordHash: newPassword ? await hashBrowserPassword(newPassword) : account.passwordHash,
    password: newPassword || account.password
  }
  writeBrowserAccount(updated)
  // Keep the login screen's remembered credentials in step with the account.
  try {
    const remembered = JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}')
    if (remembered.username) {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: newUsername, password: newPassword || remembered.password }))
    }
  } catch { /* remember-me is best-effort */ }
  withState((state) => state.audit.unshift({ id: Date.now(), user: updated.username, action: 'ACCOUNT_UPDATE', target: 'Browser preview', timestamp: new Date().toISOString() }))
  return { id: 1, username: updated.username }
}

function buildSnapshot() {
  const state = readState()
  const now = Date.now()
  const devices = state.devices.map((device) => {
    const cycle = Math.abs(Math.sin((now / 6000 + device.id) * 0.83))
    const isOffline = device.id % 11 === Math.floor(now / 12000) % 11
    const isSlow = !isOffline && device.id % 9 === Math.floor(now / 9000) % 9
    const ping_time = isOffline ? null : isSlow ? Math.round(320 + cycle * 120) : Math.max(2, Math.round(12 + cycle * 115))
    const status = statusFromPing(ping_time, !isOffline)
    const historyCount = Number(state.settings.ping_history_count) || 30
    const history = Array.from({ length: historyCount }, (_, i) => {
      const offline = i % 17 === device.id % 17
      const warning = !offline && i % 13 === device.id % 13
      const value = warning ? Math.round(315 + Math.abs(Math.sin(i * 0.31 + device.id)) * 95) : Math.round(15 + Math.abs(Math.sin(i * 0.37 + device.id)) * 85)
      return {
        sequence: i + 1,
        ping_time: offline ? null : value,
        status: offline ? 'offline' : statusFromPing(value),
        timestamp: new Date(now - (historyCount - i - 1) * Number(state.settings.ping_interval || 3) * 1000).toISOString()
      }
    })
    return { ...device, ping_time, status, history }
  })
  return { branches: state.branches, devices, generated_at: new Date().toISOString() }
}

/**
 * Browser-preview terminal. The desktop build talks to a real SSH/Telnet
 * session; here a small emulated switch CLI keeps the screen usable for demos.
 */
function demoTerminal() {
  const listeners = { data: new Set(), status: new Set() }
  const sessions = new Map()
  let counter = 0

  const emit = (kind, payload) => listeners[kind].forEach((callback) => callback(payload))
  const push = (sessionId, text) => emit('data', { sessionId, data: text })

  const respond = (session, command) => {
    const trimmed = command.trim()
    if (!trimmed) return ''
    if (/^(exit|quit|logout)$/i.test(trimmed)) {
      setTimeout(() => { sessions.delete(session.sessionId); emit('status', { sessionId: session.sessionId, state: 'closed', message: 'Session closed' }) }, 120)
      return 'Connection closed by foreign host.\r\n'
    }
    if (/^show\s+interfaces?\s+status/i.test(trimmed)) {
      return ['Port      Name        Status       Vlan   Duplex  Speed Type',
        'Gi1/0/1   Staff       connected    10     a-full a-1000 10/100/1000BaseTX',
        'Gi1/0/2   POS         connected    20     a-full  a-100 10/100/1000BaseTX',
        'Gi1/0/3   Cameras     connected    30     a-full a-1000 10/100/1000BaseTX',
        'Gi1/0/24  Uplink      connected    trunk  a-full a-1000 10/100/1000BaseTX', ''].join('\r\n')
    }
    if (/^show\s+vlan/i.test(trimmed)) {
      return ['VLAN Name          Status    Ports',
        '---- ------------- --------- -------------------------------',
        '10   Staff         active    Gi1/0/1, Gi1/0/4',
        '20   POS           active    Gi1/0/2, Gi1/0/5',
        '30   Cameras       active    Gi1/0/3',
        '99   Management    active    Vl99', ''].join('\r\n')
    }
    if (/^show\s+mac/i.test(trimmed)) {
      return ['          Mac Address Table',
        'Vlan    Mac Address       Type        Ports',
        '  10    0011.2233.4455    DYNAMIC     Gi1/0/1',
        '  20    00aa.bbcc.ddee    DYNAMIC     Gi1/0/2',
        '  30    5c02.1234.9900    DYNAMIC     Gi1/0/3', ''].join('\r\n')
    }
    if (/^show\s+running-config/i.test(trimmed)) {
      return ['Building configuration...', '', `hostname ${session.name.replace(/\s+/g, '-')}`,
        '!', 'vlan 10', ' name Staff', '!', 'vlan 20', ' name POS', '!',
        'interface GigabitEthernet1/0/24', ' switchport mode trunk', '!', 'end', ''].join('\r\n')
    }
    if (/^show\s+version/i.test(trimmed)) {
      return `Cisco IOS Software, C2960X Software, Version 15.2(7)E3\r\n${session.name} uptime is 41 days, 6 hours, 12 minutes\r\n`
    }
    if (/^(write|copy\s+run)/i.test(trimmed)) return 'Building configuration...\r\n[OK]\r\n'
    if (/^(en|enable)$/i.test(trimmed)) return ''
    if (/^\?$|^help$/i.test(trimmed)) return 'Demo commands: show interfaces status, show vlan brief, show mac address-table, show running-config, show version, write memory, exit\r\n'
    return `% Invalid input detected. This is the browser preview \u2014 install the desktop app for a real session.\r\n`
  }

  return {
    targets: async () => {
      const state = readState()
      return state.branches.map((branch) => ({
        id: branch.id, name: branch.name, code: branch.code,
        switches: state.devices.filter((device) => device.branch_id === branch.id && device.device_type === 'Switch')
          .map((device) => ({ id: device.id, name: device.name, ip: device.ip, model: device.model, location: device.location, transport: device.transport === 'telnet' ? 'telnet' : 'ssh' }))
      })).filter((branch) => branch.switches.length)
    },
    open: async ({ deviceId }) => {
      const state = readState()
      const device = state.devices.find((item) => item.id === deviceId)
      if (!device) throw new Error('Device not found')
      counter += 1
      const transport = device.transport === 'telnet' ? 'telnet' : 'ssh'
      const session = {
        sessionId: `demo-${counter}`, name: device.name, host: device.ip,
        port: transport === 'telnet' ? 23 : 22, transport, username: 'demo', line: ''
      }
      sessions.set(session.sessionId, session)
      const prompt = `${device.name.replace(/\s+/g, '-')}# `
      session.prompt = prompt
      setTimeout(() => emit('status', { sessionId: session.sessionId, state: 'connecting' }), 30)
      setTimeout(() => {
        emit('status', { sessionId: session.sessionId, state: 'connected' })
        push(session.sessionId, `Connecting to ${device.ip} over ${transport.toUpperCase()}...\r\n`)
        push(session.sessionId, 'Browser preview \u2014 emulated switch CLI. Type ? for the command list.\r\n\r\n')
        push(session.sessionId, prompt)
      }, 420)
      return { sessionId: session.sessionId, transport, host: device.ip, port: session.port, name: device.name, username: 'demo' }
    },
    write: async ({ sessionId, data }) => {
      const session = sessions.get(sessionId)
      if (!session) throw new Error('That terminal session is no longer open')
      for (const character of data) {
        if (character === '\r' || character === '\n') {
          push(sessionId, '\r\n')
          const output = respond(session, session.line)
          session.line = ''
          if (output) push(sessionId, output)
          if (sessions.has(sessionId)) push(sessionId, session.prompt)
        } else if (character === '\u007f' || character === '\b') {
          if (session.line.length) { session.line = session.line.slice(0, -1); push(sessionId, '\b \b') }
        } else if (character >= ' ') {
          session.line += character
          push(sessionId, character)
        }
      }
      return true
    },
    resize: async () => true,
    close: async (sessionId) => {
      sessions.delete(sessionId)
      emit('status', { sessionId, state: 'closed', message: 'Closed by the operator' })
      return true
    },
    onData: (callback) => { listeners.data.add(callback); return () => listeners.data.delete(callback) },
    onStatus: (callback) => { listeners.status.add(callback); return () => listeners.status.delete(callback) }
  }
}

function browserApi() {
  return {
    platform: 'browser-demo',
    auth: {
      status: async () => ({ authenticated: true }),
      login: async ({ username, password }) => {
        const account = await readBrowserAccount()
        const passwordMatches = await bcrypt.compare(String(password || ''), account.passwordHash)
        if (String(username || '').trim().toLowerCase() !== account.username.toLowerCase() || !passwordMatches) throw new Error('Invalid username or password')
        withState((state) => state.audit.unshift({ id: Date.now(), user: account.username, action: 'LOGIN', target: 'Browser preview', timestamp: new Date().toISOString() }))
        return { id: 1, username: account.username }
      },
      updateCredentials: updateBrowserCredentials,
      changePassword: async (payload) => {
        const account = await readBrowserAccount()
        await updateBrowserCredentials({ ...payload, newUsername: account.username })
        return { success: true }
      },
      logout: async () => ({ success: true }),
      // Browser-preview recovery: the same PIN gate as the desktop app,
      // backed by the browser account plus a localStorage lockout counter.
      recoverStatus: async () => {
        const account = await readBrowserAccount()
        return { pinSet: Boolean(account.recoveryPinHash) }
      },
      recover: async (pin) => {
        const account = await readBrowserAccount()
        if (!account.recoveryPinHash) throw new Error('No recovery PIN has been set. Sign in and set one in Settings → General.')
        const MAX_ATTEMPTS = 5
        const LOCK_MS = 5 * 60 * 1000
        let attempts = 0
        let lockedUntil = 0
        try {
          const stored = JSON.parse(localStorage.getItem('hyperfamily.browser.recovery-lock') || '{}')
          attempts = Number(stored.attempts) || 0
          lockedUntil = Number(stored.lockedUntil) || 0
        } catch { /* fresh counters */ }
        const now = Date.now()
        if (lockedUntil > now) return { ok: false, locked: true, retryAfterMs: lockedUntil - now, remainingAttempts: 0 }
        const matches = await bcrypt.compare(String(pin || ''), account.recoveryPinHash)
        if (!matches) {
          attempts += 1
          const lock = attempts >= MAX_ATTEMPTS
          localStorage.setItem('hyperfamily.browser.recovery-lock', JSON.stringify({ attempts: lock ? 0 : attempts, lockedUntil: lock ? now + LOCK_MS : 0 }))
          return { ok: false, locked: lock, retryAfterMs: lock ? LOCK_MS : 0, remainingAttempts: lock ? 0 : MAX_ATTEMPTS - attempts }
        }
        localStorage.setItem('hyperfamily.browser.recovery-lock', JSON.stringify({ attempts: 0, lockedUntil: 0 }))
        return { ok: true, username: account.username, password: account.password }
      },
      setRecoveryPin: async (pin) => {
        const value = String(pin || '')
        if (!/^\d{4,8}$/.test(value)) throw new Error('The recovery PIN must contain 4 to 8 digits')
        const account = await readBrowserAccount()
        account.recoveryPinHash = await bcrypt.hash(value, 10)
        writeBrowserAccount(account)
        return { success: true }
      },
      // Remember-me (v2.0.22): the login page saves the credentials AFTER a
      // successful sign-in and reads them back to prefill the form. Cleared
      // when the option is unchecked.
      rememberCredentials: async ({ username, password } = {}) => {
        const name = String(username || '').trim()
        const pass = String(password || '')
        if (!name || !pass) {
          localStorage.removeItem(REMEMBER_KEY)
          return { saved: false }
        }
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: name, password: pass }))
        return { saved: true }
      },
      rememberedCredentials: async () => {
        try {
          const stored = JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}')
          return { username: String(stored.username || ''), password: String(stored.password || '') }
        } catch { return { username: '', password: '' } }
      }
    },
    branches: {
      list: async () => readState().branches,
      save: async (data) => withState((s) => {
        const code = String(data.code || '').trim()
        const warehouseCode = String(data.warehouse_code || '').trim()
        if (!String(data.name || '').trim() || !code || !warehouseCode) throw new Error('Branch Name, Code, and Warehouse Code are required')
        if (!/^[A-Za-z0-9_-]+$/.test(code) || code.length > 20) throw new Error('Branch Code must use no more than 20 letters, numbers, dashes, or underscores')
        if (!/^[A-Za-z0-9_-]+$/.test(warehouseCode) || warehouseCode.length > 40) throw new Error('Warehouse Code must use no more than 40 letters, numbers, dashes, or underscores')
        const duplicate = s.branches.find((item) => item.id !== Number(data.id) && (item.code?.toLowerCase() === code.toLowerCase() || item.warehouse_code?.toLowerCase() === warehouseCode.toLowerCase()))
        if (duplicate) throw new Error('That Branch Code or Warehouse Code already exists')
        const cleanData = { ...data, name: String(data.name).trim(), code, warehouse_code: warehouseCode }
        const normalized = data.id
          ? { ...s.branches.find((item) => item.id === Number(data.id)), ...cleanData, id: Number(data.id) }
          : { ...cleanData, id: Math.max(0, ...s.branches.map((item) => item.id)) + 1, created_at: new Date().toISOString() }
        if (data.id) s.branches = s.branches.map((item) => item.id === normalized.id ? normalized : item)
        else s.branches.push(normalized)
        return normalized
      }),
      remove: async (id) => withState((s) => { s.branches = s.branches.filter((x) => x.id !== id); s.devices = s.devices.filter((x) => x.branch_id !== id); return { success: true } }),
      removeAll: async () => withState((s) => {
        const counts = { branchCount: s.branches.length, deviceCount: s.devices.length }
        s.branches = []
        s.devices = []
        s.audit.push({ id: Date.now(), user: 'Admin', action: 'DIRECTORY_CLEAR', target: 'all', timestamp: new Date().toISOString() })
        return { success: true, ...counts }
      })
    },
    devices: {
      list: async () => readState().devices.map((device) => ({ ...device, switch_ports: device.switch_ports || [] })),
      save: async (data) => withState((s) => {
        if (!String(data.name || '').trim()) throw new Error('Device Name is required')
        if (data.device_type === 'Router' && s.devices.some((item) => item.branch_id === Number(data.branch_id) && item.device_type === 'Router' && item.id !== Number(data.id))) throw new Error('Only one Router can be defined for each branch')
        const deviceId = data.id ? Number(data.id) : Math.max(0, ...s.devices.map((item) => item.id)) + 1
        const switchPorts = data.device_type === 'Switch' ? normalizeSwitchPorts(data.switch_ports || [], deviceId) : []
        const normalized = {
          ...data,
          id: deviceId,
          branch_id: Number(data.branch_id),
          port: data.port ? Number(data.port) : null,
          checkout_number: data.checkout_number ? Number(data.checkout_number) : null,
          connection_port: String(data.connection_port || '').trim() || null,
          switch_ports: switchPorts,
          is_dashboard_visible: data.is_dashboard_visible ? 1 : 0
        }
        if (data.id) s.devices = s.devices.map((item) => item.id === deviceId ? { ...item, ...normalized, updated_at: new Date().toISOString() } : item)
        else s.devices.push({ ...normalized, created_at: new Date().toISOString() })
        return normalized
      }),
      remove: async (id) => withState((s) => { s.devices = s.devices.filter((x) => x.id !== id); return { success: true } })
    },
    monitor: {
      snapshot: async () => buildSnapshot(),
      subscribe: (callback) => {
        const timer = setInterval(() => callback(buildSnapshot()), 3000)
        return () => clearInterval(timer)
      }
    },
    settings: {
      get: async () => readState().settings,
      save: async (patch) => withState((s) => { s.settings = { ...s.settings, ...patch }; return s.settings })
    },
    credentials: {
      list: async () => readState().credentials.map((x) => ({ ...x, password: undefined, has_password: true })),
      reveal: async (id) => readState().credentials.find((x) => x.id === id)?.password || '',
      save: async (data) => withState((s) => { s.credentials.push({ ...data, id: Date.now() }); return data }),
      remove: async (id) => withState((s) => { s.credentials = s.credentials.filter((x) => x.id !== id); return { success: true } }),
      mappings: async () => normalizeMappings(readState().mappings),
      map: async () => normalizeMappings(readState().mappings),
      forDevice: async (deviceId) => {
        const s = readState()
        const map = normalizeMappings(s.mappings)
        const device = s.devices.find((item) => item.id === deviceId)
        const ids = [...(map.devices[deviceId] || []), ...(device ? map.types[device.device_type] || [] : [])]
        const seen = new Set()
        return ids
          .filter((id) => !seen.has(id) && seen.add(id))
          .map((id) => s.credentials.find((item) => item.id === id))
          .filter(Boolean)
          .map((item) => ({ ...item, password: undefined, has_password: true }))
      },
      saveMappings: async (mappings) => withState((s) => { s.mappings = normalizeMappings(mappings); return s.mappings }),
      overview: async () => {
        const s = readState()
        const map = normalizeMappings(s.mappings)
        const nameOf = (id) => s.credentials.find((item) => item.id === id)?.name || null
        return s.devices.map((device) => {
          const directId = (map.devices[device.id] || [])[0] ?? null
          const typeId = (map.types[device.device_type] || [])[0] ?? null
          const branch = s.branches.find((item) => item.id === device.branch_id)
          return {
            device_id: device.id,
            device_name: device.name,
            device_type: device.device_type,
            ip: device.ip,
            branch_id: device.branch_id,
            branch_name: branch?.name || '—',
            credential_id: directId,
            effective_name: nameOf(directId) || nameOf(typeId),
            source: directId ? 'device' : typeId ? 'type' : 'none'
          }
        }).sort((a, b) => a.branch_name.localeCompare(b.branch_name) || a.device_name.localeCompare(b.device_name))
      },
      assignDevice: async (deviceId, credentialId) => withState((s) => {
        const map = normalizeMappings(s.mappings)
        if (credentialId === null || credentialId === undefined || credentialId === '') delete map.devices[deviceId]
        else map.devices[deviceId] = [Number(credentialId)]
        s.mappings = map
        return { device_id: Number(deviceId), credential_id: credentialId ?? null }
      }),
      assignType: async (deviceType, credentialId) => withState((s) => {
        const map = normalizeMappings(s.mappings)
        if (credentialId === null || credentialId === undefined || credentialId === '') delete map.types[deviceType]
        else map.types[deviceType] = [Number(credentialId)]
        s.mappings = map
        return { device_type: deviceType, credential_id: credentialId ?? null }
      })
    },
    inventory: {
      list: async () => {
        const s = readState()
        return buildSnapshot().devices.map((device) => {
          const branch = s.branches.find((item) => item.id === device.branch_id)
          return { ...device, branch_name: branch?.name || '—', branch_code: branch?.code || '—', branch_warehouse_code: branch?.warehouse_code || '—' }
        })
      },
      export: async () => { throw new Error('Excel export is available in the Windows desktop app') }
    },
    directory: {
      template: async () => { throw new Error('The import template can only be generated from the Windows desktop app') },
      import: async () => { throw new Error('Excel import is available in the Windows desktop app') }
    },
    remote: {
      connect: async () => { throw new Error('Remote tools can only launch from the Windows desktop app') },
      probe: async () => ({ teamviewer: null, winbox: null }),
      palette: async () => true
    },
    terminal: demoTerminal(),
    snippets: {
      list: async () => [...readState().snippets].sort((a, b) => a.name.localeCompare(b.name)),
      save: async (payload) => {
        const state = readState()
        if (!payload?.name?.trim()) throw new Error('A snippet needs a name')
        if (!payload?.command?.trim()) throw new Error('A snippet needs a command')
        // Newlines are preserved so multi-line snippets survive a round trip.
        const record = { ...payload, name: payload.name.trim(), command: String(payload.command).replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '') }
        if (payload.id) state.snippets = state.snippets.map((item) => (item.id === payload.id ? { ...item, ...record } : item))
        else state.snippets.push({ ...record, id: Date.now() })
        writeState(state)
        return record
      },
      remove: async (id) => {
        const state = readState()
        state.snippets = state.snippets.filter((item) => item.id !== id)
        writeState(state)
        return true
      }
    },
    notes: {
      // Mirrors the real ordering: pinned first, then priority, then recency.
      list: async () => [...readState().notes].sort((a, b) =>
        (b.pinned - a.pinned)
        || (Number(b.priority || 0) - Number(a.priority || 0))
        || String(b.updated_at).localeCompare(String(a.updated_at))),
      save: async (payload) => {
        const state = readState()
        if (!payload?.name?.trim()) throw new Error('A note needs a name')
        const now = new Date().toISOString()
        const record = {
          name: payload.name.trim(),
          body: payload.body || '',
          pinned: payload.pinned ? 1 : 0,
          color: NOTE_COLOR_NAMES.includes(payload.color) ? payload.color : 'default',
          priority: Math.min(2, Math.max(0, Number.parseInt(payload.priority, 10) || 0)),
          // Tags live apart from the body: sanitised, deduplicated, capped.
          tags: Array.isArray(payload.tags)
            ? [...new Set(payload.tags.map((tag) => String(tag).replace(/^#+/, '').trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20)
            : [],
          updated_at: now
        }
        if (payload.id) {
          state.notes = state.notes.map((item) => (item.id === payload.id ? { ...item, ...record } : item))
          writeState(state)
          return state.notes.find((item) => item.id === payload.id)
        }
        const created = { ...record, id: Date.now(), created_at: now }
        state.notes.push(created)
        writeState(state)
        return created
      },
      remove: async (id) => {
        const state = readState()
        state.notes = state.notes.filter((item) => item.id !== id)
        writeState(state)
        return true
      }
    },
    vpn: {
      status: async () => ({ state: 'disconnected', mode: null, proxyPort: null, live: false, serviceRunning: false, tunnelUp: false, forticlientInstalled: false }),
      probe: async () => ({ installed: false, path: null, downloadUrl: 'https://www.fortinet.com/support/product-downloads#vpn', configured: false }),
      connect: async () => { throw new Error('VPN control is available in the Windows desktop app') },
      disconnect: async () => ({ state: 'disconnected', live: false }),
      diagnose: async () => ({ ok: false, stage: 'profile', outcome: 'error', reason: 'VPN diagnostics are available in the Windows desktop app', durationMs: 0 }),
      subscribe: () => () => {}
    },
    update: {
      check: async () => ({ currentVersion: APP_VERSION, latestVersion: APP_VERSION, hasUpdate: false, releaseNotes: '', downloaded: false, downloading: false, paused: false, percent: 0, isPackaged: false }),
      state: async () => ({ downloading: false, paused: false, downloaded: false, percent: 0, version: null, canInstall: false, isPackaged: false }),
      download: async () => { throw new Error('Updates are installed from the Windows desktop app') },
      pause: async () => { throw new Error('Updates are installed from the Windows desktop app') },
      resume: async () => { throw new Error('Updates are installed from the Windows desktop app') },
      stop: async () => { throw new Error('Updates are installed from the Windows desktop app') },
      install: async () => { throw new Error('Updates are installed from the Windows desktop app') },
      subscribe: () => () => {}
    },
    storeUpdate: (() => {
      // Demo environment: simulates the Windows pipeline so the browser
      // preview shows the real UX — progressive “Checking…” → version reveals,
      // step-by-step deploy narration and the summary popup.
      const bus = () => {
        const subs = new Set()
        return { emit: (payload) => subs.forEach((cb) => { try { cb(payload) } catch { /* demo */ } }), subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb) } }
      }
      const buses = { version: bus(), step: bus(), progress: bus(), finished: bus(), agentStep: bus() }
      const importedAgents = new Set()
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const demoVersion = (co) => {
        const key = `${co.id}-${co.name || ''}`
        let hash = 0
        for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) % 997
        if (hash % 11 === 0) return { state: 'offline' }
        if (!importedAgents.has(co.id)) return { state: 'agent-not-running', detail: 'Demo: use Import Agent' }
        if (hash % 13 === 0) return { state: 'not-found' }
        return { state: 'ok', version: ['3.4.1', '3.4.1', '3.3.8', '3.2.2'][hash % 4], product: 'Store Commerce', source: 'agent', publisher: 'Microsoft', pingTime: 3 + (hash % 40) }
      }
      const jalaliToday = () => {
        try {
          const parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
          const pick = (type) => parts.find((part) => part.type === type)?.value || ''
          return `${pick('year')}${pick('month')}${pick('day')}`
        } catch { return '14050617' }
      }
      async function demoDeploySteps(entry) {
        const results = []
        for (const co of entry.checkouts) {
          const startedAt = Date.now()
          const step = (name, status, detail) => buses.step.emit({ runId: entry.runId, checkoutId: co.id, name: co.name, step: name, status, detail, at: new Date().toISOString() })
          step('source', 'done', `${entry.fileName} (demo)`)
          step('connectivity', 'running', `Pinging ${co.hostname || co.ip}…`)
          await sleep(500)
          const probe = demoVersion(co)
          if (probe.state === 'offline') { step('connectivity', 'failed', `${co.hostname || co.ip} did not answer the ping`); results.push({ checkoutId: co.id, name: co.name, host: co.hostname || co.ip, ok: false, error: 'Checkout unreachable', steps: [], durationMs: Date.now() - startedAt }); continue }
          step('connectivity', 'done', `${co.hostname || co.ip} answered in ${probe.pingTime || 8} ms`)
          await sleep(300)
          step('target', 'done', `${entry.destinationPath}\\${entry.fileName}`)
          await sleep(350)
          if ((co.id || 0) % 2 === 0) { step('backup', 'done', `${entry.fileName} → ${jalaliToday()}-${entry.fileName}`) } else { step('backup', 'skipped', 'No existing file — nothing to back up') }
          step('copy', 'running', `Copying ${entry.fileName}… (attempt 1/3)`)
          for (let percent = 0; percent <= 100; percent += 10) { buses.progress.emit({ runId: entry.runId, checkoutId: co.id, percent, attempt: 1 }); await sleep(120) }
          step('copy', 'done', '2.4 MB copied (attempt 1/3)')
          step('verify', 'running', 'Comparing SHA-256 of source and destination…')
          await sleep(500)
          step('verify', 'done', 'SHA-256 hashes match — the copy is intact')
          step('finish', 'done', `Deployed ${entry.fileName}`)
          results.push({ checkoutId: co.id, name: co.name, host: co.hostname || co.ip, ok: true, bytes: 2516582, attempts: 1, durationMs: Date.now() - startedAt })
        }
        return results
      }
      async function demoImportAgent({ checkout }) {
        const copied = !importedAgents.has(checkout.id)
        for (const [step, detail] of [['compare', copied ? 'Agent is missing — copy required (demo)' : 'SHA-256 matches — copy skipped (demo)'], ['startup', 'Configuring automatic Windows Service (demo)'], ['running', 'Agent heartbeat received (demo)']]) {
          buses.agentStep.emit({ checkoutId: checkout.id, step, detail })
          await sleep(400)
        }
        importedAgents.add(checkout.id)
        return { checkoutId: checkout.id, name: checkout.name, ok: true, copied, state: 'running' }
      }
      return {
        importAgent: demoImportAgent,
        importAgentAll: async ({ checkouts }) => {
          const results = []
          for (const checkout of checkouts) results.push(await demoImportAgent({ checkout }))
          return { total: results.length, ok: results.length, failed: 0, results }
        },
        onAgentStep: (callback) => buses.agentStep.subscribe(callback),
        version: async ({ checkout }) => { await sleep(600 + (checkout?.id || 0) * 37 % 700); return { checkoutId: checkout?.id, ...demoVersion(checkout || {}) } },
        versions: async ({ checkouts = [] }) => {
          const results = []
          for (const checkout of checkouts) {
            await sleep(500)
            const result = { checkoutId: checkout.id, name: checkout.name, ...demoVersion(checkout) }
            buses.version.emit(result)
            results.push(result)
          }
          return results
        },
        deploy: async ({ checkout, source, destinationPath }) => {
          const runId = `demo-${Date.now()}`
          const fileName = String(source || 'demo-update.exe').split(/[\\/]/).pop()
          const [result] = await demoDeploySteps({ runId, checkouts: [checkout], fileName, destinationPath })
          return result
        },
        deployAll: async ({ checkouts = [], source, destinationPath }) => {
          const runId = `demo-all-${Date.now()}`
          const fileName = String(source || 'demo-update.exe').split(/[\\/]/).pop()
          const results = await demoDeploySteps({ runId, checkouts, fileName, destinationPath })
          const summary = { runId, total: results.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, durationMs: results.reduce((sum, r) => sum + (r.durationMs || 0), 0) }
          buses.finished.emit(summary)
          return summary
        },
        testAccess: async ({ host }) => { await sleep(700); return { ok: true, host, user: 'okcs\\administrator', durationMs: 690 } },
        installed: async ({ checkout }) => {
          await sleep(800)
          if (!importedAgents.has(checkout.id)) throw new Error('Agent is not running — Import Agent first (demo)')
          const programs = [
            { name: '7-Zip 23.01 (x64)', version: '23.01', publisher: 'Igor Pavlov' },
            { name: 'Google Chrome', version: '141.0.7390.55', publisher: 'Google LLC' },
            { name: 'Microsoft Store Commerce', version: '9.52.24020.3', publisher: 'Microsoft Corporation' },
            { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', version: '14.38.33130', publisher: 'Microsoft Corporation' },
            { name: 'Store Commerce Hardware Station', version: '9.52.0.0', publisher: 'Microsoft Corporation' }
          ]
          return {
            host: checkout?.ip || checkout?.hostname,
            label: checkout?.name,
            source: 'agent',
            programs,
            total: programs.length,
            configuredName: 'Store Commerce',
            match: { name: 'Store Commerce Hardware Station', version: '9.52.0.0' }
          }
        },
        onVersion: (cb) => buses.version.subscribe(cb),
        onStep: (cb) => buses.step.subscribe(cb),
        onProgress: (cb) => buses.progress.subscribe(cb),
        onFinished: (cb) => buses.finished.subscribe(cb)
      }
    })(),
    audit: { list: async () => readState().audit.slice(0, 100) },
    dialog: { selectFile: async () => null, selectFiles: async () => [], selectDirectory: async () => null },
    app: { info: async () => ({ version: APP_VERSION, platform: 'Browser preview', dataPath: 'Local browser storage' }), openExternal: async (url) => window.open(url, '_blank', 'noopener,noreferrer') }
  }
}

let fallback
export function getApi() {
  if (typeof window !== 'undefined' && window.hyperfamily) return window.hyperfamily
  if (!fallback && typeof window !== 'undefined') fallback = browserApi()
  return fallback
}
