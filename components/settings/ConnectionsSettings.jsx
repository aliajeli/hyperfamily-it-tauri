'use client'

import { useState } from 'react'
import { PlugZap, RotateCcw, Save, Star, Check, X, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button } from '@/components/ui'
import { getApi } from '@/lib/api'
import { useSettingsStore } from '@/stores/settings.store'
import { DEVICE_TYPES, DEVICE_TYPE_DETAILS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  CONNECTION_METHODS,
  CONNECTION_METHOD_IDS,
  DEFAULT_CONNECTION_METHODS,
  connectionSettingKey,
  resolveConnectionMethods
} from '@/lib/connection-methods'

/**
 * Per-device-type connection methods — cards + dialog edition (v2.0.14).
 *
 * Every device type is a card; clicking one opens a centered window over a
 * blurred page where its connection methods can be picked. Inside the dialog:
 *
 *   - click a dim chip       -> enable the method (several can be on)
 *   - click an enabled chip  -> promote it to default (★, moves to the front)
 *   - click its ×            -> remove the method (the last one can never go)
 *
 * Framer Motion animates the selection (spring check/star pops, a pulse on
 * enable), the reorder when a method is promoted, and the dialog itself.
 */

const spring = { type: 'spring', stiffness: 600, damping: 28 }

export default function ConnectionsSettings({ settings, onSaved }) {
  const setGlobalSettings = useSettingsStore((state) => state.setSettings)
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(DEVICE_TYPES.map((type) => [type, resolveConnectionMethods(type, settings)])))
  const [openType, setOpenType] = useState(null)
  const [saving, setSaving] = useState(false)

  const openList = openType ? draft[openType] || [] : []
  const openDetail = openType ? DEVICE_TYPE_DETAILS[openType] || {} : {}

  const toggle = (type, methodId) => {
    setDraft((current) => {
      const methods = current[type] || []
      // Never leave a device type with no way to connect.
      if (methods.includes(methodId)) {
        if (methods.length === 1) {
          toast.error(`${DEVICE_TYPE_DETAILS[type]?.label || type} needs at least one connection method`)
          return current
        }
        return { ...current, [type]: methods.filter((id) => id !== methodId) }
      }
      return { ...current, [type]: [...methods, methodId] }
    })
  }

  const makeDefault = (type, methodId) => {
    setDraft((current) => {
      const methods = current[type] || []
      if (!methods.includes(methodId)) return current
      return { ...current, [type]: [methodId, ...methods.filter((id) => id !== methodId)] }
    })
  }

  const restoreDefaults = () => {
    setDraft(Object.fromEntries(DEVICE_TYPES.map((type) => [type, [...(DEFAULT_CONNECTION_METHODS[type] || ['browser'])]])))
    toast.info('Factory connection methods restored — save to apply')
  }

  const save = async () => {
    setSaving(true)
    try {
      const patch = Object.fromEntries(DEVICE_TYPES.map((type) => [connectionSettingKey(type), draft[type]]))
      const next = await getApi().settings.save(patch)
      onSaved(next)
      setGlobalSettings(next)
      toast.success('Connection methods saved')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-1.5">
        <CardTitle className="flex items-center gap-2 text-sm"><PlugZap size={15} />Connection method per device type</CardTitle>
        <CardDescription className="text-[10.5px]">
          Click a device card to choose how it is reached. Several methods can stay enabled at once; the starred one is the default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Device cards ------------------------------------------------------- */}
        <div className="grid gap-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {DEVICE_TYPES.map((type, index) => {
            const methods = draft[type] || []
            const defaultLabel = CONNECTION_METHODS[methods[0]]?.label || 'None'
            return (
              <motion.button
                key={type}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02, duration: 0.25, ease: 'easeOut' }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.985 }}
                onClick={() => setOpenType(type)}
                aria-label={`Open connection methods for ${DEVICE_TYPE_DETAILS[type]?.label || type}`}
                aria-haspopup="dialog"
                className="group relative rounded-xl border bg-[rgb(var(--surface)/.45)] p-2 text-left transition-all duration-200 hover:border-[rgb(var(--primary)/.55)] hover:bg-[rgb(var(--surface)/.8)] hover:shadow-md hover:shadow-black/5"
              >
                <div className="flex items-center gap-1.5">
                  <b className="min-w-0 flex-1 truncate text-[11px]">{DEVICE_TYPE_DETAILS[type]?.label || type}</b>
                  <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-[rgb(var(--primary)/.12)] px-1 text-[9px] font-extrabold text-[rgb(var(--primary))]">
                    {methods.length}
                  </span>
                  <ChevronRight size={12} className="shrink-0 text-[rgb(var(--muted))] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[rgb(var(--primary))]" />
                </div>
                <p className="mt-0.5 truncate text-[9.5px] text-[rgb(var(--muted))]">
                  Default: {defaultLabel}
                </p>
              </motion.button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={save} disabled={saving}><Save size={14} />{saving ? 'Saving…' : 'Save connection methods'}</Button>
          <Button size="sm" variant="secondary" onClick={restoreDefaults}><RotateCcw size={14} />Restore defaults</Button>
        </div>
      </CardContent>

      {/* Method picker dialog ------------------------------------------------ */}
      <DialogPrimitive.Root open={Boolean(openType)} onOpenChange={(open) => { if (!open) setOpenType(null) }}>
        <AnimatePresence>
          {openType && (
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
                  className="dialog-content glass fixed left-1/2 top-1/2 z-[80] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-[rgb(var(--surface))] p-3.5 shadow-2xl outline-none"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg bg-[rgb(var(--primary)/.14)] p-1.5 text-[rgb(var(--primary))]"><PlugZap size={15} /></div>
                    <div className="min-w-0">
                      <DialogPrimitive.Title className="text-sm font-extrabold">{openDetail.label || openType}</DialogPrimitive.Title>
                      <DialogPrimitive.Description className="truncate text-[10px] text-[rgb(var(--muted))]">{openDetail.description}</DialogPrimitive.Description>
                    </div>
                    <span className="ml-auto shrink-0 rounded-full bg-[rgb(var(--border)/.5)] px-2 py-0.5 text-[9.5px] font-bold text-[rgb(var(--muted))]">
                      {openList.length} enabled
                    </span>
                  </div>

                  <div className="mt-3 flex min-h-[3rem] flex-wrap items-center gap-1 rounded-xl border bg-[rgb(var(--canvas)/.55)] p-2">
                    <AnimatePresence initial={false} mode="popLayout">
                      {CONNECTION_METHOD_IDS.map((methodId) => {
                        const enabled = openList.includes(methodId)
                        const isDefault = openList[0] === methodId
                        const label = CONNECTION_METHODS[methodId].label
                        return (
                          <motion.span
                            key={methodId}
                            layout="position"
                            transition={{ layout: { type: 'spring', stiffness: 500, damping: 35 } }}
                            exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.15 } }}
                            className="group flex items-center"
                          >
                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.88 }}
                              aria-pressed={enabled}
                              title={CONNECTION_METHODS[methodId].description}
                              aria-label={
                                enabled
                                  ? (isDefault ? `${label} is the default for ${openType}` : `Make ${label} the default for ${openType}`)
                                  : `Enable ${label} for ${openType}`
                              }
                              onClick={() => (enabled ? makeDefault(openType, methodId) : toggle(openType, methodId))}
                              className={cn(
                                'relative flex h-7 items-center gap-1 overflow-hidden rounded-md border px-2 text-[10.5px] font-semibold transition-colors duration-200',
                                isDefault
                                  ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary)/.14)] text-[rgb(var(--primary))] shadow-sm'
                                  : enabled
                                    ? 'border-[rgb(var(--border))] bg-[rgb(var(--border)/.45)] text-[rgb(var(--text))] hover:border-[rgb(var(--primary)/.5)]'
                                    : 'border-transparent text-[rgb(var(--muted))] hover:bg-[rgb(var(--border)/.4)] hover:text-[rgb(var(--text))]'
                              )}
                            >
                              {/* One-shot pulse when a method is switched on. */}
                              <AnimatePresence>
                                {enabled && (
                                  <motion.span
                                    key="pulse"
                                    aria-hidden="true"
                                    initial={{ scale: 0.8, opacity: 0.65 }}
                                    animate={{ scale: 1.25, opacity: 0 }}
                                    transition={{ duration: 0.5, ease: 'easeOut' }}
                                    className="absolute inset-0 rounded-md bg-[rgb(var(--primary)/.4)]"
                                  />
                                )}
                              </AnimatePresence>

                              <span className="relative grid h-4 w-4 place-items-center">
                                <AnimatePresence initial={false}>
                                  {isDefault ? (
                                    <motion.span
                                      key="star"
                                      className="absolute inset-0 grid place-items-center"
                                      initial={{ scale: 0, rotate: -135 }}
                                      animate={{ scale: 1, rotate: 0 }}
                                      exit={{ scale: 0, rotate: 135 }}
                                      transition={spring}
                                    >
                                      <Star size={12} fill="currentColor" />
                                    </motion.span>
                                  ) : enabled ? (
                                    <motion.span
                                      key="check"
                                      className="absolute inset-0 grid place-items-center opacity-55"
                                      initial={{ scale: 0, y: 4 }}
                                      animate={{ scale: 1, y: 0 }}
                                      exit={{ scale: 0, y: -4 }}
                                      transition={spring}
                                    >
                                      <Check size={11} strokeWidth={3.5} />
                                    </motion.span>
                                  ) : null}
                                </AnimatePresence>
                              </span>
                              {label}
                            </motion.button>

                            {enabled && openList.length > 1 && (
                              <motion.button
                                type="button"
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                                transition={spring}
                                aria-label={`Remove ${label} from ${openType}`}
                                title={`Remove ${label}`}
                                onClick={() => toggle(openType, methodId)}
                                className="grid h-7 w-6 shrink-0 place-items-center rounded-r-md text-[rgb(var(--muted))] opacity-45 transition hover:bg-[rgb(var(--border)/.5)] hover:text-[rgb(var(--text))] hover:opacity-100"
                              >
                                <X size={11} strokeWidth={3} />
                              </motion.button>
                            )}
                          </motion.span>
                        )
                      })}
                    </AnimatePresence>
                  </div>

                  <p className="mt-2 px-0.5 text-[9.5px] leading-snug text-[rgb(var(--muted))]">
                    The starred method is used when a device is opened without picking one; the rest appear as alternatives in the device menu.
                  </p>

                  <div className="mt-2.5 flex items-center justify-end border-t pt-2.5">
                    <DialogPrimitive.Close asChild>
                      <Button size="sm">Done</Button>
                    </DialogPrimitive.Close>
                  </div>
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          )}
        </AnimatePresence>
      </DialogPrimitive.Root>
    </Card>
  )
}
