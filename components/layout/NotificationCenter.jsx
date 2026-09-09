'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Activity, Bell, Building2, CheckCircle2, Clock3, Router, Rocket, ScrollText, Server, ShoppingCart, TriangleAlert, WifiOff, X } from 'lucide-react'
import { useDevicesStore } from '@/stores/devices.store'
import { useUpdateStore } from '@/stores/update.store'
import DeviceStatusBadge from '@/components/dashboard/DeviceStatusBadge'

const summaryMeta = [
  { key: 'offline', label: 'Offline', icon: WifiOff, className: 'border-nord-11/35 bg-nord-11/10 text-nord-11' },
  { key: 'warning', label: 'Warning', icon: TriangleAlert, className: 'border-nord-13/40 bg-nord-13/12 status-warning-text' },
  { key: 'online', label: 'Online', icon: CheckCircle2, className: 'border-nord-14/35 bg-nord-14/10 status-online-text' },
  { key: 'branches', label: 'Branches', icon: Building2, className: 'border-nord-8/35 bg-nord-8/10 text-nord-10' }
]

const deviceIcons = { Router, Server, Checkout: ShoppingCart }

function latestCheck(device) {
  const point = device.history?.[device.history.length - 1]
  const value = point?.checked_at || point?.timestamp
  if (!value) return 'Awaiting timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Awaiting timestamp'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function NotificationCenter() {
  const router = useRouter()
  const { branches, devices, generatedAt } = useDevicesStore()
  const updateInfo = useUpdateStore((state) => state.info)
  const updateDismissed = useUpdateStore((state) => state.dismissed)
  const dismissUpdate = useUpdateStore((state) => state.dismiss)
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  const updateAvailable = Boolean(updateInfo?.hasUpdate && !updateDismissed)

  const model = useMemo(() => {
    const visible = devices.filter((device) => device.is_dashboard_visible)
    const branchMap = new Map(branches.map((branch) => [branch.id, branch]))
    const alerts = visible
      .filter((device) => device.status === 'offline' || device.status === 'warning')
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === 'offline' ? -1 : 1
        return String(left.name || '').localeCompare(String(right.name || ''))
      })
      .map((device) => ({ ...device, branch: branchMap.get(device.branch_id) }))

    return {
      alerts,
      stats: {
        branches: branches.length,
        online: visible.filter((device) => device.status === 'online').length,
        warning: visible.filter((device) => device.status === 'warning').length,
        offline: visible.filter((device) => device.status === 'offline').length
      }
    }
  }, [branches, devices])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const alertCount = model.alerts.length
  const totalCount = alertCount + (updateAvailable ? 1 : 0)

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        type="button"
        aria-label={`Notifications${totalCount ? `, ${totalCount} unread` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        whileHover={{ y: -2, scale: 1.04 }}
        whileTap={{ scale: 0.94 }}
        className={`notification-button relative grid h-10 w-10 place-items-center rounded-xl border bg-[rgb(var(--surface)/.62)] text-[rgb(var(--muted))] shadow-sm transition-colors hover:text-[rgb(var(--text))] ${open ? 'border-[rgb(var(--primary)/.5)] text-[rgb(var(--primary))] shadow-md' : ''}`}
      >
        <motion.span animate={open ? { rotate: [0, -14, 12, -7, 0] } : { rotate: 0 }} transition={{ duration: 0.45 }}>
          <Bell size={17} />
        </motion.span>
        {totalCount > 0 ? (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="notification-count absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-nord-11 px-1 text-[8px] font-black leading-none text-white shadow-md ring-2 ring-[rgb(var(--canvas))]">
            {totalCount > 99 ? '99+' : totalCount}
          </motion.span>
        ) : (
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-nord-14 ring-2 ring-[rgb(var(--surface))]" />
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="Network notifications"
            initial={{ opacity: 0, y: -10, scale: 0.96, transformOrigin: 'top right' }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -7, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 390, damping: 29 }}
            className="notification-popup glass absolute right-0 top-[calc(100%+12px)] z-50 w-[min(430px,calc(100vw-1.5rem))] overflow-hidden rounded-[22px] shadow-2xl"
          >
            <span aria-hidden="true" className="absolute -right-14 -top-16 h-36 w-36 rounded-full bg-[rgb(var(--primary)/.06)] blur-3xl" />
            <header className="relative flex items-start justify-between border-b px-4 py-3.5">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-black tracking-[0.025em]"><Bell size={15} className="text-[rgb(var(--primary))]" /> Network notifications</h2>
                <p className="mt-1 text-[9px] font-semibold text-[rgb(var(--muted))]">
                  {generatedAt ? `Updated ${new Date(generatedAt).toLocaleTimeString()}` : 'Connecting to monitor…'}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications" className="grid h-7 w-7 place-items-center rounded-lg text-[rgb(var(--muted))] transition-all hover:rotate-90 hover:bg-[rgb(var(--border)/.55)] hover:text-[rgb(var(--text))]"><X size={14} /></button>
            </header>

            <div className="relative p-3.5">
              <div className="grid grid-cols-4 gap-1.5" aria-label="Network summary">
                {summaryMeta.map(({ key, label, icon: Icon, className }, index) => (
                  <motion.div key={key} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 + index * 0.035 }} className={`min-w-0 rounded-xl border p-2 ${className}`}>
                    <div className="flex items-center justify-between gap-1"><Icon size={12} /><span className="text-sm font-black tabular-nums">{generatedAt ? model.stats[key] : '—'}</span></div>
                    <p className="mt-1 truncate text-[7px] font-extrabold uppercase tracking-[0.1em]">{label}</p>
                  </motion.div>
                ))}
              </div>

              {updateAvailable && (
                <motion.article
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-2.5 rounded-xl border border-[rgb(var(--primary)/.45)] bg-[rgb(var(--primary)/.07)] p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[rgb(var(--primary))] text-white shadow-md">
                      <Rocket size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[10.5px] font-extrabold tracking-[0.03em]">
                        Update available
                        <span className="rounded-full bg-[rgb(var(--primary)/.16)] px-1.5 py-0.5 text-[8px] font-black text-[rgb(var(--primary))]">v{updateInfo.latestVersion}</span>
                      </p>
                      <p className="truncate text-[8.5px] font-semibold text-[rgb(var(--muted))]">
                        You are on v{updateInfo.currentVersion} — a newer release is ready to download.
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Dismiss update notification"
                      title="Dismiss"
                      onClick={dismissUpdate}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[rgb(var(--muted))] transition hover:bg-[rgb(var(--border)/.5)] hover:text-[rgb(var(--text))]"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {updateInfo.releaseNotes && (
                    <div className="mt-2 rounded-lg border bg-[rgb(var(--surface)/.7)] p-2">
                      <p className="flex items-center gap-1 text-[8px] font-extrabold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">
                        <ScrollText size={9} /> Changelog
                      </p>
                      <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[9px] leading-relaxed text-[rgb(var(--muted))]">
                        {updateInfo.releaseNotes}
                      </p>
                    </div>
                  )}

                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setOpen(false); router.push('/about') }}
                      className="flex h-7 items-center gap-1.5 rounded-lg bg-[rgb(var(--primary))] px-2.5 text-[9.5px] font-extrabold text-white shadow-sm transition hover:brightness-110"
                    >
                      <Rocket size={11} /> Open About to update
                    </button>
                    {updateInfo.downloadUrl && (
                      <button
                        type="button"
                        onClick={() => { setOpen(false); window.open(updateInfo.downloadUrl, '_blank', 'noopener,noreferrer') }}
                        className="flex h-7 items-center gap-1.5 rounded-lg border bg-[rgb(var(--surface)/.7)] px-2.5 text-[9.5px] font-extrabold text-[rgb(var(--text))] transition hover:bg-[rgb(var(--surface))]"
                      >
                        GitHub release
                      </button>
                    )}
                  </div>
                </motion.article>
              )}

              <div className="mb-2 mt-4 flex items-center justify-between px-0.5">
                <p className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-[rgb(var(--muted))]"><Activity size={11} /> Active alerts</p>
                <span className="text-[9px] font-black tabular-nums text-[rgb(var(--muted))]">{alertCount}</span>
              </div>

              {alertCount ? (
                <div className="max-h-[310px] space-y-1.5 overflow-y-auto pr-1">
                  {model.alerts.map((device, index) => {
                    const Icon = deviceIcons[device.device_type] || Server
                    const ping = device.last_ping_ms ?? device.ping_time
                    return (
                      <motion.article key={device.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index, 8) * 0.035 }} className="group flex min-w-0 items-center gap-2.5 rounded-xl border bg-[rgb(var(--surface)/.82)] p-2.5 transition-all hover:-translate-y-0.5 hover:bg-[rgb(var(--surface))] hover:shadow-md">
                        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${device.status === 'offline' ? 'bg-nord-11/12 text-nord-11' : 'bg-nord-13/15 status-warning-text'}`}><Icon size={14} /></div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[10px] font-extrabold tracking-[0.03em]" title={device.name}>{device.name}</p>
                          <p className="truncate text-[8px] font-semibold text-[rgb(var(--muted))]">{device.branch?.name || 'Unknown branch'} · {device.ip_address || device.ip}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[7px] text-[rgb(var(--muted))]"><Clock3 size={8} /> Last check {latestCheck(device)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <DeviceStatusBadge status={device.status} compact />
                          <p className="mt-1 text-[8px] font-black tabular-nums text-[rgb(var(--muted))]">{Number.isFinite(ping) ? `${ping} ms` : 'No reply'}</p>
                        </div>
                      </motion.article>
                    )
                  })}
                </div>
              ) : (
                <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="grid min-h-32 place-items-center rounded-2xl border border-nord-14/30 bg-nord-14/8 p-5 text-center">
                  <div>
                    <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2.2, repeat: Infinity }} className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-nord-14/16 status-online-text"><CheckCircle2 size={20} /></motion.div>
                    <p className="mt-2 text-xs font-black">All monitored devices are healthy</p>
                    <p className="mt-1 text-[9px] text-[rgb(var(--muted))]">No active Offline or Warning notifications.</p>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
