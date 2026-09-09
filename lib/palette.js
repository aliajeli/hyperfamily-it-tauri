'use client'

export const PALETTE_KEYS = ['canvas', 'surface', 'border', 'text', 'muted', 'primary', 'danger', 'success']

/**
 * Reads the active theme's colour channels off the document root so auxiliary
 * windows (device auto-login views) can be painted with the same palette.
 */
export function currentPalette() {
  if (typeof window === 'undefined') return {}
  const styles = window.getComputedStyle(document.documentElement)
  return Object.fromEntries(
    PALETTE_KEYS.map((key) => [key, styles.getPropertyValue(`--${key}`).trim()]).filter(([, value]) => value)
  )
}
