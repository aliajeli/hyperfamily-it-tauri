'use client'

import { motion } from 'framer-motion'
import { CreditCard, HardDrive, Monitor, Network, Pencil, Plus, Router, Scale, Server, ShoppingCart, Trash2, Video, Wifi } from 'lucide-react'
import { Badge, Button, EmptyState, Switch } from '@/components/ui'
import { DEVICE_TYPE_DETAILS } from '@/lib/constants'

const icons = { Router, Switch: Network, iLO: HardDrive, Server, NVR: Video, AccessPoint: Wifi, Scale, Client: Monitor, Checkout: ShoppingCart, POS: CreditCard }

function titleFor(device) {
  if (device.name) return device.name
  if (device.device_type === 'Checkout' && device.checkout_number) return `Checkout ${device.checkout_number}`
  if (device.device_type === 'POS' && device.checkout_number) return `POS · Checkout ${device.checkout_number}`
  if (device.hostname) return device.hostname
  if (device.model) return device.model
  return DEVICE_TYPE_DETAILS[device.device_type]?.label || device.device_type
}

function detailsFor(device) {
  const candidates = {
    Router: [device.model, device.asset_code],
    Switch: [device.model, device.location, device.connection_port && `Connection ${device.connection_port}`],
    iLO: [device.esxi_version && `ESXi ${device.esxi_version}`, device.model],
    Server: [device.hostname],
    NVR: [device.model, device.asset_code],
    AccessPoint: [device.model, device.location, device.port && `Port ${device.port}`],
    Scale: [device.model, device.location, device.serial_number && `S/N ${device.serial_number}`],
    Client: [device.user, device.domain],
    Checkout: [device.hostname],
    POS: [device.brand, device.model, device.terminal_id && `Terminal ${device.terminal_id}`]
  }
  return (candidates[device.device_type] || []).filter(Boolean).slice(0, 2)
}

export default function DeviceList({ devices, branch, onEdit, onDelete, onAdd, onDashboardChange, dashboardSavingId }) {
  if (!devices.length) {
    return (
      <EmptyState
        icon={<Network />}
        title={`No devices in ${branch.name}`}
        description="Select Add device, choose an equipment type, and enter the device information."
        action={<Button size="sm" onClick={onAdd}><Plus size={14} />Add first device</Button>}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {devices.map((device, index) => {
        const Icon = icons[device.device_type] || Network
        const details = detailsFor(device)
        const ports = Array.isArray(device.switch_ports) ? device.switch_ports.length : 0
        return (
          <motion.article
            key={device.id}
            initial={{ opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index, 10) * 0.018 }}
            whileHover={{ y: -2 }}
            className="directory-device-card group relative min-w-0 overflow-hidden rounded-lg border bg-[rgb(var(--surface)/.7)] p-1.5 shadow-sm"
          >
            <span aria-hidden="true" className="absolute -right-9 -top-10 h-20 w-20 rounded-full bg-[rgb(var(--primary)/.07)] blur-2xl transition-transform duration-500 group-hover:scale-150" />
            <div className="relative flex min-w-0 items-start gap-1.5">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[rgb(var(--primary)/.11)] text-[rgb(var(--primary))] ring-1 ring-[rgb(var(--primary)/.12)]"><Icon size={13} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start justify-between gap-1">
                  <div className="min-w-0">
                    <p className="text-[7px] font-extrabold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">{DEVICE_TYPE_DETAILS[device.device_type]?.label || device.device_type}</p>
                    <h3 className="truncate text-[10px] font-black tracking-[0.02em]" title={titleFor(device)}>{titleFor(device)}</h3>
                  </div>
                  <Badge status={device.status || 'unknown'} className="shrink-0 gap-1 px-1 py-0 text-[7px] capitalize">{device.status || 'unknown'}</Badge>
                </div>
                <p className="mt-0.5 truncate font-mono text-[8px] font-bold text-[rgb(var(--primary))]">{device.ip}{device.port ? `:${device.port}` : ''}</p>
              </div>
            </div>

            <div className="relative mt-1 flex min-h-3.5 flex-wrap gap-1">
              {details.map((detail) => <span key={detail} className="max-w-full truncate rounded-md bg-[rgb(var(--canvas)/.8)] px-1.5 py-0.5 text-[7px] font-semibold text-[rgb(var(--muted))]">{detail}</span>)}
              {device.device_type === 'Switch' && <span className="rounded-md bg-nord-8/12 px-1.5 py-0.5 text-[7px] font-extrabold text-nord-10">{ports} ports</span>}
              {!details.length && device.device_type !== 'Switch' && <span className="text-[7px] text-[rgb(var(--muted))]">No optional details</span>}
            </div>

            <div className="relative mt-1 flex items-center justify-between border-t pt-0.5">
              <label className="flex min-w-0 items-center gap-1.5 text-[7px] font-bold text-[rgb(var(--muted))]">
                <Switch
                  compact
                  checked={Boolean(device.is_dashboard_visible)}
                  disabled={dashboardSavingId !== null}
                  onCheckedChange={(checked) => onDashboardChange(device, checked)}
                  aria-label={`Show ${titleFor(device)} on Dashboard`}
                />
                <span className={device.is_dashboard_visible ? 'status-online-text' : ''}>{dashboardSavingId === device.id ? 'Saving…' : device.is_dashboard_visible ? 'Dashboard on' : 'Dashboard off'}</span>
              </label>
              <div className="flex gap-0.5">
                <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => onEdit(device)} aria-label={`Edit ${titleFor(device)}`} title="Edit device"><Pencil size={10} /></Button>
                <Button type="button" variant="ghost" size="icon" className="h-5 w-5 text-nord-11" onClick={() => onDelete(device)} aria-label={`Delete ${titleFor(device)}`} title="Delete device"><Trash2 size={10} /></Button>
              </div>
            </div>
          </motion.article>
        )
      })}
    </div>
  )
}
