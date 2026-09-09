'use client'

import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { getApi } from '@/lib/api'
import { applyTheme, readRememberedTheme, parseCustomColors } from '@/lib/themes'
import { applyTypography, rememberTypography, readRememberedTypography } from '@/lib/typography'
import { useSettingsStore } from '@/stores/settings.store'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import InteractionGuard from './InteractionGuard'

export default function AppProviders({ children }) {
  const setSettings = useSettingsStore((state) => state.setSettings)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const settings = await getApi().settings.get()
        if (!alive) return
        setSettings(settings)
        // The saved setting wins, but a profile without one keeps whatever the
        // pre-paint boot script already restored instead of snapping back.
        applyTheme(settings.theme || readRememberedTheme() || 'aurora', parseCustomColors(settings.theme_custom))
        // Fonts and interface scale live in the same settings row; cache them
        // so the next launch applies them before the first paint.
        applyTypography(settings)
        rememberTypography(settings)
      } catch {
        // Before sign-in there is no database yet; the remembered values are
        // all we have, and they are what the login screen is painted with.
        applyTheme(readRememberedTheme() || 'aurora')
        applyTypography(readRememberedTypography())
      }
    }
    load()
    const reload = () => load()
    window.addEventListener('hyperfamily:data-changed', reload)
    return () => { alive = false; window.removeEventListener('hyperfamily:data-changed', reload) }
  }, [setSettings])

  // Uniform viewport scale in the browser preview: the layout is designed
  // around a 1366×768 viewport and Electron applies webContents.setZoomFactor
  // natively, so here — and only here — a CSS zoom mirrors the same mapping.
  // Both environments render the identical layout at every resolution.
  useEffect(() => {
    if (typeof window === 'undefined' || window.hyperfamily) return undefined
    const apply = () => {
      const scale = Math.min(window.innerWidth / 1366, window.innerHeight / 768)
      document.documentElement.style.zoom = String(Math.min(2.5, Math.max(0.6, scale)))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])

  return <ConfirmProvider>
    <InteractionGuard />
    {children}
    <Toaster richColors position="bottom-right" closeButton />
  </ConfirmProvider>
}
