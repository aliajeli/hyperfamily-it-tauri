'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Router, Maximize2, Radio } from 'lucide-react'
import PingChart from './PingChart'
import DeviceActionsMenu from './DeviceActionsMenu'
import DeviceStatusBadge from './DeviceStatusBadge'

const gatewayTreatment = {
  online: 'border-nord-14/50 bg-gradient-to-br from-nord-14/15 via-[rgb(var(--surface))] to-[rgb(var(--canvas))]',
  warning: 'border-nord-13/60 bg-gradient-to-br from-nord-13/18 via-[rgb(var(--surface))] to-[rgb(var(--canvas))]',
  offline: 'border-nord-11/50 bg-gradient-to-br from-nord-11/15 via-[rgb(var(--surface))] to-[rgb(var(--canvas))]',
  unknown: 'border-[rgb(var(--border))] bg-[rgb(var(--canvas))]'
}

const gatewayGlow = {
  online: 'bg-nord-14/20',
  warning: 'bg-nord-13/20',
  offline: 'bg-nord-11/20',
  unknown: 'bg-nord-8/15'
}

export default function RouterChartCard({ branch, gateway, expanded = false }) {
  const navigation = useRouter()

  if (!gateway) {
    return (
      <div className={`${expanded ? 'h-44' : 'h-28'} grid place-items-center rounded-2xl border border-dashed text-[9px] font-semibold text-[rgb(var(--muted))]`}>
        <div className="text-center">
          <Radio className="mx-auto mb-2 opacity-55" size={20} />
          No Router configured
        </div>
      </div>
    )
  }

  const gatewayStatus = gateway.status || 'unknown'
  const gatewayPing = gateway.last_ping_ms ?? gateway.ping_time
  const openGatewayDetails = () => navigation.push(`/dashboard/gateway?branch=${encodeURIComponent(branch.id)}&device=${encodeURIComponent(gateway.id)}`)

  return (
    <motion.div
      whileHover={{ y: -3, scale: 1.005 }}
      transition={{ type: 'spring', stiffness: 360, damping: 24 }}
      className={`router-monitor-card group relative overflow-visible rounded-2xl border shadow-sm hover:z-30 ${gatewayTreatment[gatewayStatus] || gatewayTreatment.unknown}`}
    >
      <span aria-hidden="true" className={`pointer-events-none absolute -right-1 -top-1 h-24 w-24 rounded-full blur-2xl transition-all duration-500 group-hover:scale-150 ${gatewayGlow[gatewayStatus] || gatewayGlow.unknown}`} />
      <button type="button" onClick={openGatewayDetails} className={`relative block w-full text-left ${expanded ? 'p-4' : 'p-2.5'}`} aria-label={`Open detailed Router chart for ${branch.name}`}>
        <div className="flex min-w-0 items-center gap-2 pr-7">
          <motion.div whileHover={{ rotate: -8, scale: 1.08 }} className={`${expanded ? 'h-10 w-10' : 'h-8 w-8'} grid shrink-0 place-items-center rounded-xl bg-[rgb(var(--surface))] text-nord-8 shadow-sm ring-1 ring-[rgb(var(--border)/.7)]`}>
            <Router size={expanded ? 19 : 16} />
          </motion.div>
          <div className="min-w-0 flex-1">
            <p className="text-[8px] font-extrabold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">Router</p>
            <p className={`${expanded ? 'text-sm' : 'text-[11px]'} truncate font-extrabold tracking-[0.025em]`} title={gateway.name}>{gateway.name}</p>
          </div>
          <div className="text-right">
            <DeviceStatusBadge status={gatewayStatus} compact={!expanded} />
            <p className={`${expanded ? 'text-xs' : 'text-[10px]'} mt-1 font-extrabold tabular-nums`}>{gatewayPing == null ? 'No reply' : `${gatewayPing} ms`}</p>
          </div>
        </div>

        <div className={`${expanded ? 'mt-3 px-2' : 'mt-1.5 px-1'} overflow-visible rounded-xl bg-[rgb(var(--surface)/.58)] ring-1 ring-[rgb(var(--border)/.35)]`}>
          <PingChart history={gateway.history} compact={!expanded} />
        </div>
        <p className={`${expanded ? 'mt-3 text-[10px]' : 'mt-1.5 text-[8px]'} flex items-center justify-center gap-1 font-bold text-[rgb(var(--primary))] transition-all group-hover:gap-2`}>
          <Maximize2 size={expanded ? 11 : 9} /> Select chart for detailed view
        </p>
      </button>
      <div className="absolute right-2 top-2">
        <DeviceActionsMenu device={gateway} />
      </div>
    </motion.div>
  )
}
