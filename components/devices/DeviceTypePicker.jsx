'use client'

import { motion } from 'framer-motion'
import { CreditCard, HardDrive, LockKeyhole, Monitor, Network, Router, Scale, Server, ShoppingCart, Video, Wifi } from 'lucide-react'
import { DEVICE_TYPES, DEVICE_TYPE_DETAILS } from '@/lib/constants'

const icons = {
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

const tones = {
  Router: 'bg-nord-8/16 text-nord-10',
  Switch: 'bg-nord-9/16 text-nord-10',
  iLO: 'bg-nord-15/15 text-nord-15',
  Server: 'bg-nord-10/14 text-nord-10',
  NVR: 'bg-nord-11/12 text-nord-11',
  AccessPoint: 'bg-nord-14/16 status-online-text',
  Scale: 'bg-nord-13/18 status-warning-text',
  Client: 'bg-nord-7/18 text-nord-10',
  Checkout: 'bg-nord-12/15 text-nord-12',
  POS: 'bg-[rgb(var(--primary)/.13)] text-[rgb(var(--primary))]'
}

export default function DeviceTypePicker({ branch, onSelect, unavailableTypes = [] }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border bg-[rgb(var(--canvas)/.55)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[8px] font-extrabold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">Add equipment to</p>
          <p className="truncate text-xs font-black">{branch.name} <span className="font-mono text-[9px] text-[rgb(var(--muted))]">· {branch.code}</span></p>
        </div>
        <span className="shrink-0 rounded-full border bg-[rgb(var(--surface)/.72)] px-2.5 py-1 text-[8px] font-extrabold text-[rgb(var(--muted))]">Choose one type</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {DEVICE_TYPES.map((type, index) => {
          const Icon = icons[type]
          const detail = DEVICE_TYPE_DETAILS[type]
          const unavailable = unavailableTypes.includes(type)
          return (
            <motion.button
              key={type}
              type="button"
              disabled={unavailable}
              onClick={() => !unavailable && onSelect(type)}
              initial={{ opacity: 0, y: 7 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.018 }}
              whileHover={unavailable ? undefined : { y: -2, scale: 1.008 }}
              whileTap={unavailable ? undefined : { scale: 0.98 }}
              className="device-type-option group relative min-h-28 overflow-hidden rounded-xl border bg-[rgb(var(--surface)/.7)] p-2.5 text-left shadow-sm transition-colors hover:border-[rgb(var(--primary)/.34)] hover:bg-[rgb(var(--surface))] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span aria-hidden="true" className="absolute -right-8 -top-10 h-20 w-20 rounded-full bg-[rgb(var(--primary)/.07)] blur-2xl transition-transform duration-500 group-hover:scale-150" />
              <span className={`relative grid h-8 w-8 place-items-center rounded-xl ${tones[type]}`}>{unavailable ? <LockKeyhole size={14} /> : <Icon size={15} />}</span>
              <span className="relative mt-2 block text-xs font-black tracking-[0.02em]">{detail.label}</span>
              <span className="relative mt-0.5 block text-[8px] leading-3 text-[rgb(var(--muted))]">{unavailable ? 'One Router is already defined for this branch.' : detail.description}</span>
              <span className="relative mt-1.5 inline-flex text-[8px] font-extrabold uppercase tracking-[0.1em] text-[rgb(var(--primary))]">{unavailable ? 'Unavailable' : 'Select →'}</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
