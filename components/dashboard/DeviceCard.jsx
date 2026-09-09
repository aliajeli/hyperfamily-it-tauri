'use client'

import { motion } from 'framer-motion'
import { CreditCard, HardDrive, Monitor, Network, Router, Scale, Server, ShoppingCart, Video, Wifi } from 'lucide-react'
import DeviceActionsMenu from './DeviceActionsMenu'
import DeviceStatusBadge from './DeviceStatusBadge'

// Keep Dashboard equipment symbols aligned with the Branches & Devices picker.
// Previously only three types were mapped, so every other saved type rendered as
// an unrelated ellipsis symbol in the Dashboard details view.
const iconMap = {
  Router,
  Switch: Network,
  iLO: HardDrive,
  Server,
  NVR: Video,
  AccessPoint: Wifi,
  Scale,
  Client: Monitor,
  Checkout: ShoppingCart,
  POS: CreditCard
}

const treatment = {
  online: 'border-nord-14/40 bg-gradient-to-br from-nord-14/10 via-[rgb(var(--surface))] to-[rgb(var(--surface))]',
  warning: 'border-nord-13/50 bg-gradient-to-br from-nord-13/13 via-[rgb(var(--surface))] to-[rgb(var(--surface))]',
  offline: 'border-nord-11/40 bg-gradient-to-br from-nord-11/10 via-[rgb(var(--surface))] to-[rgb(var(--surface))]',
  unknown: 'border-[rgb(var(--border))] bg-[rgb(var(--surface))]'
}

const decoration = {
  online: { halo: 'bg-nord-14/20', icon: 'text-[#688550] ring-nord-14/25' },
  warning: { halo: 'bg-nord-13/24', icon: 'text-[#8a7027] ring-nord-13/30' },
  offline: { halo: 'bg-nord-11/20', icon: 'text-nord-11 ring-nord-11/25' },
  unknown: { halo: 'bg-nord-8/14', icon: 'text-[rgb(var(--primary))] ring-[rgb(var(--border))]' }
}

export default function DeviceCard({ device, label }) {
  const Icon = iconMap[device.device_type] || Monitor
  const state = device.status || 'unknown'
  const lastPing = device.last_ping_ms ?? device.ping_time
  const address = device.ip_address || device.ip
  const ping = Number.isFinite(lastPing) ? `${lastPing} ms` : 'No reply'
  const style = decoration[state] || decoration.unknown

  return (
    <motion.article
      whileHover={{ y: -3, scale: 1.008 }}
      transition={{ type: 'spring', stiffness: 420, damping: 25 }}
      className={`device-card group relative min-w-0 overflow-hidden rounded-xl border p-2 shadow-sm ${treatment[state] || treatment.unknown}`}
    >
      <span aria-hidden="true" className={`absolute -left-6 -top-7 h-16 w-16 rounded-full blur-2xl transition-all duration-500 group-hover:scale-150 ${style.halo}`} />
      <span aria-hidden="true" className={`absolute left-5 right-5 top-0 h-px bg-gradient-to-r from-transparent via-current to-transparent opacity-35 ${style.icon.split(' ')[0]}`} />
      <div className="relative flex min-w-0 items-start gap-2">
        <motion.div whileHover={{ rotate: -7, scale: 1.08 }} className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[rgb(var(--canvas)/.76)] shadow-sm ring-1 transition-shadow duration-300 group-hover:shadow-md ${style.icon}`}>
          <Icon size={15} />
        </motion.div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-extrabold leading-4 tracking-[0.035em]" title={device.name}>{label || device.name}</p>
          <p className="truncate font-mono text-[8px] leading-3 tracking-[0.025em] text-[rgb(var(--muted))]" title={address}>{address}</p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <DeviceStatusBadge status={state} compact />
            <span className="truncate text-[8px] font-bold tabular-nums text-[rgb(var(--muted))]">{ping}</span>
          </div>
        </div>

        <DeviceActionsMenu device={device} />
      </div>
    </motion.article>
  )
}
