/**
 * Application typography: the font catalogue, the five configurable text
 * groups, and the CSS-variable plumbing that applies them.
 *
 * Only fonts that ship with Windows (plus the generic system stacks) are
 * offered, because the app runs offline on branch machines and a webfont would
 * silently fall back to something else.
 */

export const MONO_FONTS = [
  { id: 'ui-monospace', label: 'System Monospace', stack: 'ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, "Liberation Mono", monospace' },
  { id: 'cascadia', label: 'Cascadia Mono', stack: '"Cascadia Mono", "Cascadia Code", Consolas, monospace' },
  { id: 'consolas', label: 'Consolas', stack: 'Consolas, "Lucida Console", monospace' },
  { id: 'courier', label: 'Courier New', stack: '"Courier New", Courier, monospace' },
  { id: 'lucida', label: 'Lucida Console', stack: '"Lucida Console", Monaco, monospace' },
  { id: 'dejavu', label: 'DejaVu Sans Mono', stack: '"DejaVu Sans Mono", "Liberation Mono", monospace' }
]

export const UI_FONTS = [
  { id: '', label: 'Default Font', stack: '' },
  { id: 'system', label: 'System UI', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'segoe', label: 'Segoe UI', stack: '"Segoe UI", system-ui, sans-serif' },
  { id: 'calibri', label: 'Calibri', stack: 'Calibri, Candara, "Segoe UI", sans-serif' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Verdana, sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: '"Trebuchet MS", Tahoma, sans-serif' },
  ...MONO_FONTS.map((font) => ({ ...font, label: `${font.label} (mono)` }))
]

/**
 * The five groups the user asked for. Each owns a CSS variable pair that the
 * stylesheet consumes, so changing a group restyles every matching element.
 */
export const FONT_GROUPS = [
  { id: 'header', label: 'Header', variable: '--font-header', sizeVariable: '--font-header-scale', description: 'Page titles and the top bar', sample: 'Application settings' },
  { id: 'title', label: 'Title', variable: '--font-title', sizeVariable: '--font-title-scale', description: 'Card and section headings', sample: 'FortiClient SSL VPN' },
  { id: 'text', label: 'Text', variable: '--font-text', sizeVariable: '--font-text-scale', description: 'Body copy, labels and buttons', sample: 'The quick brown fox jumps over the lazy dog.' },
  { id: 'info', label: 'Info', variable: '--font-info', sizeVariable: '--font-info-scale', description: 'Hints, captions and helper text', sample: 'Credentials are encrypted with Windows DPAPI.' },
  { id: 'mono', label: 'Monospace', variable: '--font-mono', sizeVariable: '--font-mono-scale', description: 'IP addresses, ports and console text', sample: '10.40.5.14:8291 — Gi1/0/24' }
]

export const SCALE_MIN = 50
export const SCALE_MAX = 200
export const SCALE_STEP = 5

/**
 * The pixel size each group actually renders at when its scale is 100 %.
 * Mirrors globals.css: header = 1.5rem page titles, title/text = 1rem body,
 * info = 0.75rem field labels, mono = the terminal default.
 */
export const FONT_GROUP_BASE_PX = {
  header: 24,
  title: 16,
  text: 16,
  info: 12,
  mono: 13
}

/**
 * Per-group scale limits (v2.0.15).
 *
 * The interface is laid out for the default sizes; extreme scales were
 * blowing text out of its containers. Each group is therefore clamped to a
 * range that stays safely inside the layout:
 *
 *   header 24px → 18–30px    title 16px → 13–20px    text 16px → 13–20px
 *   info 12px → 10–16px      mono 13px → 10–17px
 *
 * Everything funnels through normalizeScale, so stored values from older
 * versions are pulled back into range on load as well.
 */
export const FONT_GROUP_SCALE_RANGE = {
  header: { min: 75, max: 125 },
  title: { min: 80, max: 125 },
  text: { min: 80, max: 125 },
  info: { min: 80, max: 130 },
  mono: { min: 80, max: 130 }
}

/** Rounds an arbitrary number onto the step-5 grid, clamped to the group's
    safe range (or the global 50–200 % when no group is given). */
export function normalizeScale(value, groupId) {
  const range = (groupId && FONT_GROUP_SCALE_RANGE[groupId]) || { min: SCALE_MIN, max: SCALE_MAX }
  const number = Number(value)
  if (!Number.isFinite(number)) return 100
  const stepped = Math.round(number / SCALE_STEP) * SCALE_STEP
  return Math.min(range.max, Math.max(range.min, stepped))
}

/**
 * Scale <-> pixel helpers (v2.0.12).
 *
 * Storage stays on the percent grid so older settings keep working, but the
 * Fonts tab speaks in the pixels the user actually sees. pxForScale is
 * deterministic for every stored scale and scaleForPx(pxForScale(s)) === s, so
 * the dropdown can bind to the pixel value without ever drifting.
 */
export function pxForScale(groupId, scale) {
  const base = FONT_GROUP_BASE_PX[groupId] || 16
  return Math.round((base * normalizeScale(scale, groupId)) / 100)
}

export function scaleForPx(groupId, px) {
  const base = FONT_GROUP_BASE_PX[groupId] || 16
  return normalizeScale((Number(px) / base) * 100, groupId)
}

/** Whole-pixel options a group offers, across its safe range. */
export function pxOptionsFor(groupId) {
  const base = FONT_GROUP_BASE_PX[groupId] || 16
  const range = FONT_GROUP_SCALE_RANGE[groupId] || { min: SCALE_MIN, max: SCALE_MAX }
  const min = Math.max(6, Math.round((base * range.min) / 100))
  const max = Math.round((base * range.max) / 100)
  const options = []
  for (let px = min; px <= max; px += 1) options.push(px)
  return options
}

/** Resolves a stored font id to a CSS font stack; unknown ids fall back to ''. */
export function fontStack(id, catalogue = UI_FONTS) {
  if (!id) return ''
  const found = catalogue.find((font) => font.id === id)
  return found ? found.stack : ''
}

export function monoStack(id) {
  return fontStack(id, MONO_FONTS) || MONO_FONTS[0].stack
}

export const TERMINAL_FONT_SIZE_MIN = 8
export const TERMINAL_FONT_SIZE_MAX = 16

export function normalizeTerminalFontSize(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 13
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(number)))
}

/**
 * Writes the typography settings onto the document root. Everything is applied
 * as CSS variables so no component needs to know a font was changed.
 *
 * Each font group carries its own relative size multiplier; there is no global
 * interface scale.
 */
export const TYPOGRAPHY_STORAGE_KEY = 'hyperfamily.typography'

/** The subset of settings that describes typography, in storage form. */
export function typographySnapshot(settings = {}) {
  const snapshot = {}
  for (const group of FONT_GROUPS) {
    snapshot[`font_${group.id}_family`] = settings[`font_${group.id}_family`] || ''
    snapshot[`font_${group.id}_size`] = normalizeScale(settings[`font_${group.id}_size`] ?? 100, group.id)
  }
  return snapshot
}

/**
 * Caches typography in localStorage so the boot script in app/layout.js can
 * restore it before the first paint, exactly as the theme is restored.
 */
export function rememberTypography(settings) {
  try { localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(typographySnapshot(settings))) } catch { /* storage may be unavailable */ }
}

export function readRememberedTypography() {
  try {
    const raw = localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function applyTypography(settings = {}, root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root) return
  for (const group of FONT_GROUPS) {
    const catalogue = group.id === 'mono' ? MONO_FONTS : UI_FONTS
    const stack = fontStack(settings[`font_${group.id}_family`], catalogue)
    if (stack) root.style.setProperty(group.variable, stack)
    else root.style.removeProperty(group.variable)

    const size = normalizeScale(settings[`font_${group.id}_size`] ?? 100, group.id)
    root.style.setProperty(group.sizeVariable, String(size / 100))
  }
}
