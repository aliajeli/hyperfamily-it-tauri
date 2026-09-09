import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatDate(value, withTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date)
}

export function isValidHost(value) {
  if (!value || value.length > 253) return false
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
  const hostname = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
  return ipv4.test(value) || hostname.test(value)
}

export function statusFromPing(pingTime, online = true) {
  if (!online || pingTime == null) return 'offline'
  return pingTime <= 300 ? 'online' : 'warning'
}

export function safeFilename(value) {
  return String(value || 'All').replace(/[^a-z0-9_-]/gi, '_')
}

/** 0 B, 12.4 KB, 184 MB… for file sizes in the copy tool and version checks. */
export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let scaled = value
  let unit = 'B'
  for (const next of units) {
    if (scaled < 1024) break
    scaled /= 1024
    unit = next
  }
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)} ${unit}`
}

/** 42001 → "42 s", 72000 → "1.2 min" — for copy-run durations. */
export function formatDuration(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1000) return `${Math.round(value)} ms`
  if (value < 60000) return `${(value / 1000).toFixed(1)} s`
  return `${(value / 60000).toFixed(1)} min`
}

/**
 * Collapses the deploy narration into one row per pipeline step.
 *
 * The backend emits a step as it happens — 'running' first, then 'done',
 * 'failed' or 'skipped' — as SEPARATE events for the same step. Rendering the
 * raw stream therefore leaves a permanently spinning 'running' row above every
 * finished one. Keyed by step name, the latest event wins, which also keeps a
 * genuine retry (copy re-running after a SHA-256 mismatch) visible.
 *
 * `settled` means the run has already returned: anything still 'running' then
 * lost its completion event and is shown as done rather than spinning forever.
 */
export function collapseSteps(entries, settled = false) {
  const byStep = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) byStep.set(entry.step, entry)
  const rows = [...byStep.values()]
  if (!settled) return rows
  return rows.map((entry) => (entry.status === 'running' ? { ...entry, status: 'done' } : entry))
}
