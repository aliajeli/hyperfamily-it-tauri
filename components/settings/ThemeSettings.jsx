'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Moon, Palette, Sun, Sparkles, Wand2, RotateCcw, Save, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import {
  THEMES,
  THEME_FAMILIES,
  THEME_VARS,
  THEME_VAR_DETAILS,
  CUSTOM_THEME_ID,
  applyTheme,
  applyThemeAnimated,
  findTheme,
  buildCustomTheme,
  defaultCustomColors,
  parseCustomColors,
  tripletToHex,
  hexToTriplet
} from '@/lib/themes'
import { Button } from '@/components/ui'
import { getApi } from '@/lib/api'
import { useSettingsStore } from '@/stores/settings.store'
import { cn } from '@/lib/utils'

const spring = { type: 'spring', stiffness: 550, damping: 30 }

/**
 * Theme picker plus a full custom-palette editor.
 *
 * Preset cards repaint the whole app through a pointer-origin ripple
 * (lib/themes.js); the custom editor lives in a centered modal with a blurred
 * backdrop (v2.0.13). Editing a swatch still previews live on the page behind
 * the modal; saving persists what is on screen, and closing the modal — or
 * leaving the tab — without saving restores the stored theme, so an experiment
 * can never be stranded half-applied.
 */
export default function ThemeSettings({ settings, onSaved }) {
  const setGlobalSettings = useSettingsStore((state) => state.setSettings)
  const [family, setFamily] = useState('all')
  const [mode, setMode] = useState('all')
  const [busy, setBusy] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [custom, setCustom] = useState(() => ({ ...defaultCustomColors(), ...(parseCustomColors(settings.theme_custom) || {}) }))
  const [dirty, setDirty] = useState(false)

  const isCustomActive = settings.theme === CUSTOM_THEME_ID
  const customTheme = useMemo(() => buildCustomTheme(custom), [custom])

  // Abandoning an unsaved experiment must not leave the app in those colours.
  useEffect(() => () => {
    if (dirty) applyTheme(settings.theme || THEMES[0].id, parseCustomColors(settings.theme_custom))
    // The cleanup intentionally reads the values captured at unmount time.
  }, [dirty, settings.theme, settings.theme_custom])

  const visible = useMemo(() => THEMES.filter((theme) => (
    (family === 'all' || theme.family === family) && (mode === 'all' || theme.mode === mode)
  )), [family, mode])

  const persist = async (patch, label, revert) => {
    try {
      const next = await getApi().settings.save(patch)
      onSaved(next)
      setGlobalSettings(next)
      setDirty(false)
      toast.success(label)
    } catch (error) {
      revert?.()
      toast.error(error.message)
    }
  }

  const choose = async (theme, event) => {
    const previous = findTheme(settings.theme, parseCustomColors(settings.theme_custom))
    // The whole app repaints through a ripple that grows out of the cursor.
    applyThemeAnimated(theme, null, event ? { x: event.clientX, y: event.clientY } : null)
    setBusy(theme.id)
    await persist({ theme: theme.id }, `${theme.name} applied`, () => applyTheme(previous))
    setBusy('')
  }

  const editColor = (key, hex) => {
    const nextColors = { ...custom, [key]: hexToTriplet(hex) }
    setCustom(nextColors)
    setDirty(true)
    // Live preview: the whole app repaints as the slider moves.
    applyTheme(buildCustomTheme(nextColors))
  }

  const saveCustom = async (event) => {
    setBusy(CUSTOM_THEME_ID)
    applyThemeAnimated(customTheme, null, event ? { x: event.clientX, y: event.clientY } : null)
    await persist(
      { theme: CUSTOM_THEME_ID, theme_custom: JSON.stringify(custom) },
      'Custom theme saved',
      () => applyTheme(findTheme(settings.theme, parseCustomColors(settings.theme_custom)))
    )
    setBusy('')
    setDialogOpen(false)
  }

  const startFrom = (theme) => {
    const nextColors = Object.fromEntries(THEME_VARS.map((key) => [key, theme[key]]))
    setCustom(nextColors)
    setDirty(true)
    applyTheme(buildCustomTheme(nextColors))
    toast.info(`Custom theme seeded from ${theme.name} — press Save to keep it`)
  }

  const closeDialog = (open) => {
    setDialogOpen(open)
    // Closing the editor without saving abandons the experiment: the page
    // goes back to the stored theme, exactly like leaving the tab did before.
    if (!open && dirty) {
      setDirty(false)
      applyTheme(settings.theme || THEMES[0].id, parseCustomColors(settings.theme_custom))
    }
  }

  const filterButton = (label, active, onClick, key) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-2 py-0.5 text-[11px] font-bold transition',
        active
          ? 'bg-[rgb(var(--primary))] text-white shadow-sm'
          : 'text-[rgb(var(--muted))] hover:bg-[rgb(var(--border)/.5)] hover:text-[rgb(var(--text))]'
      )}
    >{label}</button>
  )

  return (
    <div className="space-y-2.5">
      <div className="flex flex-col gap-2 rounded-xl border bg-[rgb(var(--surface)/.42)] px-2.5 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-[rgb(var(--primary)/.14)] p-1.5 text-[rgb(var(--primary))]"><Palette size={15} /></div>
          <div>
            <h2 className="text-[13px] font-extrabold">Appearance</h2>
            <p className="text-[10.5px] text-[rgb(var(--muted))]">{THEMES.length} palettes plus your own custom theme. Applied instantly.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border bg-[rgb(var(--surface)/.6)] p-0.5">
            {filterButton('All sets', family === 'all', () => setFamily('all'), 'all')}
            {THEME_FAMILIES.map((item) => filterButton(item, family === item, () => setFamily(item), item))}
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border bg-[rgb(var(--surface)/.6)] p-0.5">
            {filterButton('Any', mode === 'all', () => setMode('all'), 'any')}
            {filterButton(<span className="flex items-center gap-1"><Sun size={11} />Light</span>, mode === 'light', () => setMode('light'), 'light')}
            {filterButton(<span className="flex items-center gap-1"><Moon size={11} />Dark</span>, mode === 'dark', () => setMode('dark'), 'dark')}
          </div>
          <Button
            type="button"
            size="sm"
            variant={isCustomActive ? 'default' : 'secondary'}
            onClick={() => setDialogOpen(true)}
          >
            <Wand2 size={14} />Custom theme
          </Button>
        </div>
      </div>

      {/* Square palette tiles (v2.0.14): each theme is one square card — a
          2×2 swatch grid over the canvas colour, name underneath. 41 palettes
          scroll inside their own bounded region so the settings page itself
          never grows a scrollbar. */}
      <div className="scroll-y grid max-h-[62vh] gap-2 overflow-y-auto pr-0.5 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
        {visible.map((theme) => {
          const selected = settings.theme === theme.id
          return (
            <motion.button
              key={theme.id}
              type="button"
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.97 }}
              onClick={(event) => choose(theme, event)}
              disabled={busy === theme.id}
              className={cn(
                'group relative flex aspect-square flex-col overflow-hidden rounded-xl border p-1 text-left transition-all duration-300',
                selected
                  ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary)/.1)] shadow-lg shadow-[rgb(var(--primary)/.25)] ring-2 ring-[rgb(var(--primary)/.35)]'
                  : 'bg-[rgb(var(--surface)/.45)] hover:border-[rgb(var(--primary)/.45)] hover:bg-[rgb(var(--surface)/.8)] hover:shadow-lg hover:shadow-black/5'
              )}
            >
              {selected && (
                <motion.span
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={spring}
                  className="absolute right-1 top-1 z-10 grid h-4 w-4 place-items-center rounded-full bg-[rgb(var(--primary))] text-white shadow"
                >
                  <Check size={9} strokeWidth={3} />
                </motion.span>
              )}
              {/* The palette itself: four swatches over the canvas colour. */}
              <span
                className="grid flex-1 grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-lg border p-1"
                style={{ background: `rgb(${theme.canvas})` }}
              >
                <span className="rounded-[4px]" style={{ background: `rgb(${theme.surface})` }} />
                <span className="rounded-[4px]" style={{ background: `rgb(${theme.primary})` }} />
                <span className="rounded-[4px]" style={{ background: `rgb(${theme.secondary})` }} />
                <span className="rounded-[4px]" style={{ background: `rgb(${theme.accent})` }} />
              </span>
              <span className="flex items-center gap-0.5 px-0.5 pb-0.5 pt-1">
                <b className="min-w-0 flex-1 truncate text-[9px]" title={theme.name}>{theme.name}</b>
                <span className="shrink-0 text-[rgb(var(--muted))]" title={`${theme.family} · ${theme.mode}`}>
                  {theme.mode === 'dark' ? <Moon size={7} /> : <Sun size={7} />}
                </span>
              </span>
            </motion.button>
          )
        })}
      </div>

      {!visible.length && (
        <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-xs text-[rgb(var(--muted))]">
          <Sparkles size={14} />No theme matches these filters.
        </p>
      )}

      {/* Custom palette editor: a centered modal over a blurred page. -------- */}
      <DialogPrimitive.Root open={dialogOpen} onOpenChange={closeDialog}>
        <AnimatePresence>
          {dialogOpen && (
            <DialogPrimitive.Portal forceMount>
              <DialogPrimitive.Overlay asChild forceMount>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-[70] bg-nord-0/55 backdrop-blur-md"
                />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content asChild forceMount>
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="dialog-content glass fixed left-1/2 top-1/2 z-[80] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-[rgb(var(--surface))] p-3.5 shadow-2xl outline-none"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-lg bg-[rgb(var(--primary)/.14)] p-1.5 text-[rgb(var(--primary))]"><Wand2 size={15} /></div>
                    <div>
                      <DialogPrimitive.Title className="text-sm font-extrabold">Custom theme</DialogPrimitive.Title>
                      <DialogPrimitive.Description className="text-[10px] text-[rgb(var(--muted))]">
                        Every change previews live behind this window.
                      </DialogPrimitive.Description>
                    </div>
                    {isCustomActive && !dirty && (
                      <span className="flex items-center gap-1 rounded-full bg-nord-14/20 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-[#66834e]"><Check size={9} strokeWidth={3} />Active</span>
                    )}
                    {dirty && <span className="rounded-full bg-nord-13/25 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-[#8b6e1c]">Unsaved</span>}
                    <DialogPrimitive.Close asChild>
                      <button
                        type="button"
                        aria-label="Close custom theme editor"
                        className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-[rgb(var(--muted))] transition hover:bg-[rgb(var(--border)/.5)] hover:text-[rgb(var(--text))]"
                      >
                        <X size={15} />
                      </button>
                    </DialogPrimitive.Close>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {THEME_VARS.map((key) => {
                      const detail = THEME_VAR_DETAILS[key] || { label: key, hint: '' }
                      const hex = tripletToHex(custom[key])
                      return (
                        <label key={key} className="flex items-center gap-2 rounded-lg border bg-[rgb(var(--canvas)/.6)] p-1.5" title={detail.hint}>
                          <input
                            type="color"
                            aria-label={`${detail.label} colour`}
                            value={hex}
                            onChange={(event) => editColor(key, event.target.value)}
                            className="h-8 w-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0"
                          />
                          <span className="min-w-0">
                            <b className="block truncate text-[10.5px] leading-tight">{detail.label}</b>
                            <span className="block font-mono text-[9px] uppercase text-[rgb(var(--muted))]">{hex}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
                    <p className="mr-auto text-[9.5px] leading-snug text-[rgb(var(--muted))]">
                      Reset seeds this palette from the currently active theme.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => startFrom(findTheme(settings.theme === CUSTOM_THEME_ID ? THEMES[0].id : settings.theme))}
                    >
                      <RotateCcw size={14} />Reset
                    </Button>
                    <Button type="button" size="sm" onClick={(event) => saveCustom(event)} disabled={busy === CUSTOM_THEME_ID}>
                      <Save size={14} />{busy === CUSTOM_THEME_ID ? 'Saving…' : 'Save & apply'}
                    </Button>
                  </div>
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          )}
        </AnimatePresence>
      </DialogPrimitive.Root>
    </div>
  )
}
