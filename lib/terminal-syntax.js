/**
 * Terminal syntax vocabulary and tokeniser.
 *
 * The console talks to branch switches, so the vocabulary is the operational
 * and configuration CLI shared by Cisco IOS style devices, with the MikroTik
 * and HP/Aruba words the fleet also uses. Two things are built on top of it:
 *
 *  - `tokenize()` colours text the device echoed back, so a command line reads
 *    like an editor instead of a wall of grey.
 *  - `completions()` powers Tab completion and the Ctrl+Space picker.
 *
 * Token classes map onto theme colours in the terminal renderer, so the
 * highlighting follows whichever of the app themes is active.
 */

// Everyday operational commands: safe, read-only, run from the exec prompt.
export const OPERATIONAL_COMMANDS = [
  'show', 'ping', 'traceroute', 'telnet', 'ssh', 'exit', 'quit', 'end', 'logout',
  'enable', 'disable', 'terminal', 'more', 'dir', 'pwd', 'cd', 'clear', 'cls',
  'reload', 'write', 'copy', 'verify', 'test', 'debug', 'undebug', 'monitor',
  'traceroute6', 'ping6', 'who', 'whoami', 'history', 'help', 'export', 'print',
  'display', 'save', 'refresh', 'ls', 'cat', 'tail', 'find', 'grep', 'echo'
]

// Administrative and configuration commands: these change device state.
export const CONFIG_COMMANDS = [
  'configure', 'config', 'hostname', 'interface', 'vlan', 'ip', 'ipv6', 'no',
  'switchport', 'spanning-tree', 'channel-group', 'port-channel', 'shutdown',
  'description', 'duplex', 'speed', 'mtu', 'bandwidth', 'router', 'network',
  'route', 'access-list', 'permit', 'deny', 'username', 'password', 'secret',
  'enable-secret', 'crypto', 'key', 'aaa', 'line', 'login', 'logging', 'snmp-server',
  'ntp', 'clock', 'banner', 'service', 'boot', 'default', 'errdisable', 'storm-control',
  'trunk', 'access', 'native', 'allowed', 'mode', 'encapsulation', 'name', 'address',
  'gateway', 'dhcp', 'pool', 'nat', 'firewall', 'filter', 'bridge', 'set', 'add',
  'remove', 'edit', 'disable-port', 'poe', 'power', 'lldp', 'cdp', 'mac', 'arp',
  'qos', 'policy-map', 'class-map', 'vrf', 'tacacs-server', 'radius-server'
]

// Sub-keywords that commonly follow a command; they complete too but are not
// highlighted as commands themselves.
export const KEYWORDS = [
  'running-config', 'startup-config', 'version', 'interfaces', 'brief', 'status',
  'vlan-switch', 'summary', 'detail', 'counters', 'neighbors', 'database', 'table',
  'address-table', 'inventory', 'environment', 'processes', 'memory', 'cpu', 'log',
  'users', 'sessions', 'uptime', 'temperature', 'transceiver', 'errors', 'all',
  'trunk', 'access', 'up', 'down', 'active', 'inactive', 'enable', 'disable',
  'input', 'output', 'both', 'in', 'out', 'any', 'host', 'eq', 'gt', 'lt', 'range',
  'gigabitethernet', 'fastethernet', 'tengigabitethernet', 'ethernet', 'loopback',
  'vlan', 'port-channel', 'management', 'console', 'vty'
]

// A dangerous subset that deserves the warning colour so a destructive line is
// visually obvious before Enter is pressed.
export const DESTRUCTIVE_COMMANDS = ['reload', 'erase', 'delete', 'format', 'shutdown', 'no', 'clear', 'reset', 'factory-reset']

export const ALL_COMMANDS = Array.from(new Set([...OPERATIONAL_COMMANDS, ...CONFIG_COMMANDS])).sort()

// Everything the completer may offer, commands first so they rank above nouns.
export const COMPLETION_VOCABULARY = Array.from(new Set([...ALL_COMMANDS, ...KEYWORDS])).sort()

const OPERATIONAL = new Set(OPERATIONAL_COMMANDS)
const CONFIGURATION = new Set(CONFIG_COMMANDS)
const KEYWORD = new Set(KEYWORDS)
const DESTRUCTIVE = new Set(DESTRUCTIVE_COMMANDS)

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/
const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|^([0-9a-f]{4}\.){2}[0-9a-f]{4}$/i
const NUMERIC = /^\d+([.:/]\d+)*$/
const INTERFACE_REF = /^(gi|fa|te|et|eth|xe|po|vl|lo|se)[a-z]*[\s]?\d+(\/\d+)*(\.\d+)?$/i

/**
 * Classifies a single bare word. `first` marks the first word of a line, which
 * is the only position where a word is treated as the command itself.
 */
function classifyWord(word, first) {
  const lower = word.toLowerCase()
  if (IPV4.test(lower) || MAC.test(lower)) return 'address'
  if (NUMERIC.test(lower)) return 'number'
  if (INTERFACE_REF.test(lower)) return 'interface'
  if (DESTRUCTIVE.has(lower)) return 'destructive'
  if (first && CONFIGURATION.has(lower)) return 'config'
  if (first && OPERATIONAL.has(lower)) return 'command'
  if (CONFIGURATION.has(lower)) return 'config'
  if (OPERATIONAL.has(lower)) return 'command'
  if (KEYWORD.has(lower)) return 'keyword'
  if (lower.startsWith('-')) return 'flag'
  return 'text'
}

/**
 * Splits a line into `{ text, kind }` tokens. Whitespace is preserved as plain
 * tokens so the caller can re-render the line without shifting any column.
 *
 * Everything after a prompt marker is treated as the command; text before it
 * (the device prompt) is dimmed, which is what makes a session readable.
 */
export function tokenize(line) {
  if (!line) return []
  const tokens = []

  // A prompt looks like "Switch#", "Switch(config)#", "user@host:~$" or "[admin@rb] >".
  const promptMatch = line.match(/^(\s*\S*[>#$%])(\s|$)/)
  let rest = line
  let offset = 0
  if (promptMatch) {
    tokens.push({ text: promptMatch[1], kind: 'prompt' })
    offset = promptMatch[1].length
    rest = line.slice(offset)
  }

  // A quoted string or a trailing comment wins over word classification.
  const parts = rest.split(/(\s+|"[^"]*"|'[^']*'|[!#][^\n]*$)/).filter((part) => part !== undefined && part !== '')
  let seenWord = false
  for (const part of parts) {
    if (/^\s+$/.test(part)) { tokens.push({ text: part, kind: 'plain' }); continue }
    if (/^["'].*["']$/.test(part)) { tokens.push({ text: part, kind: 'string' }); continue }
    if (/^[!#]/.test(part) && !promptMatch) { tokens.push({ text: part, kind: 'comment' }); continue }
    tokens.push({ text: part, kind: classifyWord(part, !seenWord) })
    seenWord = true
  }
  return tokens
}

/**
 * Returns the vocabulary entries that start with `prefix`, case-insensitively.
 * An empty prefix returns the command list only, so Ctrl+Space on a blank line
 * is a useful menu rather than a dump of every noun.
 */
export function completions(prefix) {
  const value = String(prefix || '').toLowerCase()
  if (!value) return ALL_COMMANDS.slice()
  return COMPLETION_VOCABULARY.filter((word) => word.startsWith(value) && word !== value)
}

/**
 * The longest string every candidate begins with. Tab inserts this so pressing
 * it with several matches still advances as far as it unambiguously can.
 */
export function commonPrefix(words) {
  if (!words.length) return ''
  let prefix = words[0]
  for (const word of words.slice(1)) {
    let index = 0
    while (index < prefix.length && index < word.length && prefix[index] === word[index]) index += 1
    prefix = prefix.slice(0, index)
    if (!prefix) break
  }
  return prefix
}

/**
 * Extracts the word currently being typed from a locally tracked input line.
 * Completion only ever applies to the token under the cursor.
 */
export function currentWord(input) {
  const match = String(input || '').match(/[^\s]*$/)
  return match ? match[0] : ''
}
