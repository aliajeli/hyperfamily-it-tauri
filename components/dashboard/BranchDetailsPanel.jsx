'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { Activity, Building2, CheckCircle2, MapPin, TriangleAlert, WifiOff, X } from 'lucide-react'
import RouterChartCard from './RouterChartCard'
import DeviceCard from './DeviceCard'
import { displayLabel, orderedEquipment, visibleBranchDevices } from './devicePresentation'

const summaryMeta = [
  { key: 'online', label: 'Online', icon: CheckCircle2, className: 'border-nord-14/35 bg-nord-14/10 status-online-text' },
  { key: 'warning', label: 'Warning', icon: TriangleAlert, className: 'border-nord-13/40 bg-nord-13/12 status-warning-text' },
  { key: 'offline', label: 'Offline', icon: WifiOff, className: 'border-nord-11/35 bg-nord-11/10 text-nord-11' }
]

const listVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.035, delayChildren: 0.12 } }
}

const itemVariants = {
  hidden: { opacity: 0, y: 10, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 330, damping: 26 } }
}

export default function BranchDetailsPanel({ branch, devices, view = 'modal', onClose }) {
  if (!branch) return null

  const visible = visibleBranchDevices(branch.id, devices)
  const gateway = visible.find((device) => device.device_type === 'Router')
  const equipment = orderedEquipment(visible)
  const summary = {
    online: visible.filter((device) => device.status === 'online').length,
    warning: visible.filter((device) => device.status === 'warning').length,
    offline: visible.filter((device) => device.status === 'offline').length
  }
  const sidePanel = view === 'side_panel'

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dashboard-dialog-overlay fixed inset-0 z-50 bg-nord-0/60 backdrop-blur-md" />
        <DialogPrimitive.Content
          className={sidePanel
            ? 'dashboard-branch-side glass fixed bottom-0 right-0 top-0 z-50 w-[min(560px,calc(100%-1rem))] overflow-hidden rounded-l-[28px] border-y-0 border-r-0 shadow-2xl outline-none'
            : 'dashboard-branch-modal glass fixed left-1/2 top-1/2 z-50 h-[min(92vh,860px)] max-h-[92vh] w-[calc(100%-2rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] shadow-2xl outline-none'}
        >
          <span aria-hidden="true" className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[rgb(var(--primary)/.13)] blur-3xl" />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-0 h-72 w-72 rounded-full bg-[rgb(var(--secondary)/.11)] blur-3xl" />

          <div className={`relative flex h-full flex-col ${sidePanel ? 'max-h-screen' : 'max-h-[92vh]'}`}>
            <header className="shrink-0 border-b bg-[rgb(var(--surface)/.44)] px-5 py-4 backdrop-blur-xl sm:px-6">
              <div className="flex min-w-0 items-start gap-3 pr-11">
                <motion.div initial={{ rotate: -12, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', delay: 0.12 }} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[rgb(var(--primary)/.14)] text-[rgb(var(--primary))] ring-1 ring-[rgb(var(--primary)/.15)]">
                  <MapPin size={20} />
                </motion.div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <DialogPrimitive.Title className="truncate text-lg font-black tracking-[0.035em] sm:text-xl">{branch.name}</DialogPrimitive.Title>
                    <span className="rounded-lg bg-[rgb(var(--border)/.55)] px-2 py-1 font-mono text-[9px] font-extrabold tracking-wider">{branch.code}</span>
                  </div>
                  <DialogPrimitive.Description className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-[rgb(var(--muted))]">
                    <Activity size={11} /> All devices selected for Dashboard monitoring
                  </DialogPrimitive.Description>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {summaryMeta.map(({ key, label, icon: Icon, className }, index) => (
                  <motion.div key={key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + index * 0.05 }} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${className}`}>
                    <Icon size={14} className="shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-black leading-none tabular-nums">{summary[key]}</span>
                      <span className="mt-0.5 block truncate text-[7px] font-extrabold uppercase tracking-[0.13em]">{label}</span>
                    </span>
                  </motion.div>
                ))}
              </div>
            </header>

            <DialogPrimitive.Close asChild>
              <button aria-label="Close branch details" className="group absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-xl border bg-[rgb(var(--surface)/.72)] text-[rgb(var(--muted))] shadow-sm transition-all duration-300 hover:rotate-90 hover:scale-105 hover:bg-[rgb(var(--surface))] hover:text-[rgb(var(--text))]">
                <X size={17} />
              </button>
            </DialogPrimitive.Close>

            <div className="relative flex-1 overflow-y-auto p-4 sm:p-5">
              <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-5">
                <motion.div variants={itemVariants}>
                  <RouterChartCard branch={branch} gateway={gateway} expanded />
                </motion.div>

                <motion.section variants={itemVariants}>
                  <div className="mb-2.5 flex items-center justify-between px-0.5">
                    <div>
                      <h3 className="flex items-center gap-2 text-xs font-black tracking-[0.04em]"><Building2 size={14} className="text-[rgb(var(--primary))]" /> Monitored equipment</h3>
                      <p className="mt-0.5 text-[9px] text-[rgb(var(--muted))]">Visibility is controlled by each device&apos;s Dashboard setting.</p>
                    </div>
                    <span className="rounded-full border bg-[rgb(var(--surface)/.7)] px-2.5 py-1 text-[9px] font-black tabular-nums">{equipment.length}</span>
                  </div>

                  {equipment.length ? (
                    <div className={`grid gap-2 ${sidePanel ? 'grid-cols-1 sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
                      {equipment.map((device, index) => (
                        <motion.div key={device.id} variants={itemVariants} custom={index}>
                          <DeviceCard device={device} label={displayLabel(device)} />
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid h-24 place-items-center rounded-2xl border border-dashed text-center text-[10px] text-[rgb(var(--muted))]">
                      No additional Dashboard devices for this branch
                    </div>
                  )}
                </motion.section>
              </motion.div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
