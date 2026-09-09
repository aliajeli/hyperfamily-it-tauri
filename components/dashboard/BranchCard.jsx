'use client'

import { motion } from 'framer-motion'
import { Activity, ChevronRight, MapPin } from 'lucide-react'
import RouterChartCard from './RouterChartCard'
import DeviceCard from './DeviceCard'
import { displayLabel, orderedEquipment, visibleBranchDevices } from './devicePresentation'

export default function BranchCard({ branch, devices, compact = false, onOpenDetails, index = 0 }) {
  const visible = visibleBranchDevices(branch.id, devices)
  const gateway = visible.find((device) => device.device_type === 'Router')
  const displayDevices = orderedEquipment(visible)
  const online = visible.filter((device) => device.status === 'online').length

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.055, type: 'spring', stiffness: 250, damping: 25 }}
      whileHover={{ y: -4 }}
      className="branch-card panel group/branch relative min-w-0 overflow-visible hover:z-20"
      aria-label={`${branch.name} branch status`}
    >
      <header className="relative overflow-hidden border-b px-3 py-2.5">
        <span aria-hidden="true" className="absolute -left-8 -top-8 h-20 w-20 rounded-full bg-[rgb(var(--primary)/.1)] blur-2xl transition-transform duration-700 group-hover/branch:scale-150" />
        <div className="relative flex min-w-0 items-center gap-2">
          <motion.div whileHover={{ rotate: -10, scale: 1.08 }} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))] ring-1 ring-[rgb(var(--primary)/.12)]">
            <MapPin size={15} />
          </motion.div>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={onOpenDetails} className="branch-title-button interactive-sheen group/title flex max-w-full items-center gap-1.5 rounded-lg p-[2px] text-left" aria-label={`Open all monitored equipment for ${branch.name}`}>
              <h2 className="truncate text-xs font-extrabold tracking-[0.04em]" title={branch.name}>{branch.name}</h2>
              <span className="shrink-0 rounded-md bg-[rgb(var(--border)/.55)] px-1.5 py-0.5 font-mono text-[7px] font-bold tracking-wider">{branch.code}</span>
              <ChevronRight size={12} className="shrink-0 text-[rgb(var(--primary))] transition-transform duration-300 group-hover/title:translate-x-1" />
            </button>
            <p className="mt-0.5 flex items-center gap-1 text-[8px] font-semibold text-[rgb(var(--muted))]">
              <Activity size={9} className="text-[rgb(var(--primary))]" /> {online}/{visible.length} monitored devices online
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-2 p-2.5">
        <RouterChartCard branch={branch} gateway={gateway} />

        {!compact && (
          <>
            <div className="flex items-center justify-between px-0.5">
              <p className="text-[8px] font-extrabold uppercase tracking-[0.17em] text-[rgb(var(--muted))]">Monitored equipment</p>
              <span className="text-[8px] font-semibold tabular-nums text-[rgb(var(--muted))]">{displayDevices.length}</span>
            </div>

            {displayDevices.length ? (
              <div className="space-y-1.5">
                {displayDevices.map((device) => <DeviceCard key={device.id} device={device} label={displayLabel(device)} />)}
              </div>
            ) : (
              <div className="grid h-14 place-items-center rounded-xl border border-dashed text-center text-[9px] text-[rgb(var(--muted))]">
                No Dashboard devices for this branch
              </div>
            )}
          </>
        )}
      </div>
    </motion.section>
  )
}
