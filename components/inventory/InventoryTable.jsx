'use client'

import { Boxes, Eye, EyeOff } from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui'
import DeviceActionsMenu from '@/components/dashboard/DeviceActionsMenu'

const typeLabel = (type) => type === 'AccessPoint' ? 'Access Point' : type

function deviceTitle(device) {
  if (device.name) return device.name
  if (device.hostname) return device.hostname
  if (device.checkout_number) return `${typeLabel(device.device_type)} ${device.checkout_number}`
  return device.model || typeLabel(device.device_type)
}

function connectionDetails(device) {
  const details = []
  if (device.connection_type) details.push(device.connection_type)
  if (device.connection_port) details.push(`Port ${device.connection_port}`)
  if (device.device_type === 'Switch') details.push(`${device.switch_ports?.length || 0} ports`)
  return details
}

/* Percentage widths keep every column inside the viewport at any resolution. */
const columns = [
  { key: 'branch', label: 'Branch', width: '13%' },
  { key: 'type', label: 'Type', width: '9%' },
  { key: 'device', label: 'Device', width: '15%' },
  { key: 'ip', label: 'IP', width: '10%' },
  { key: 'model', label: 'Model / version', width: '12%' },
  { key: 'location', label: 'Location', width: '7%' },
  { key: 'asset', label: 'Asset / serial', width: '12%' },
  { key: 'connection', label: 'Connection', width: '9%' },
  { key: 'status', label: 'Status', width: '10%' },
  { key: 'actions', label: '', width: '3%' }
]

export default function InventoryTable({ devices }) {
  if (!devices.length) return <EmptyState icon={<Boxes />} title="No matching assets" description="Change the active filters or add devices to your branch directory." />

  return (
    <div className="w-full overflow-y-auto" style={{ maxHeight: 'calc(100vh - 20.5rem)' }}>
      <table className="w-full table-fixed text-left text-[11px]">
        <colgroup>{columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
        <thead className="sticky top-0 bg-[rgb(var(--surface))]">
          <tr className="border-b text-[9.5px] uppercase tracking-wider text-[rgb(var(--muted))]">
            {columns.map((column) => (
              <th key={column.key} className={`px-2 py-2 ${column.key === 'actions' ? 'text-right' : ''}`}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => {
            const connection = connectionDetails(device)
            const title = deviceTitle(device)
            return (
              <tr key={device.id} className="border-b align-top last:border-0 hover:bg-[rgb(var(--border)/.22)]">
                <td className="px-2 py-1.5">
                  <b className="block truncate" title={device.branch_name}>{device.branch_name}</b>
                  <p className="truncate font-mono text-[9px] text-[rgb(var(--muted))]">{device.branch_code}{device.branch_warehouse_code ? ` · WH ${device.branch_warehouse_code}` : ''}</p>
                </td>
                <td className="px-2 py-1.5">
                  <span className="inline-block max-w-full truncate rounded-md bg-[rgb(var(--primary)/.1)] px-1.5 py-0.5 text-[10px] font-bold text-[rgb(var(--primary))]">{typeLabel(device.device_type)}</span>
                </td>
                <td className="px-2 py-1.5">
                  <b className="block truncate" title={title}>{title}</b>
                  {device.hostname && device.hostname !== title && <p className="truncate font-mono text-[9px] text-[rgb(var(--muted))]">{device.hostname}</p>}
                  {device.user && <p className="truncate text-[9px] text-[rgb(var(--muted))]">{device.domain ? `${device.domain}\\` : ''}{device.user}</p>}
                </td>
                <td className="truncate px-2 py-1.5 font-mono" title={device.ip}>{device.ip}{device.port ? `:${device.port}` : ''}</td>
                <td className="px-2 py-1.5">
                  <span className="block truncate" title={device.model || ''}>{device.model || '—'}</span>
                  {device.esxi_version && <p className="truncate text-[9px] text-[rgb(var(--muted))]">ESXI {device.esxi_version}</p>}
                  {device.version && <p className="truncate text-[9px] text-[rgb(var(--muted))]">SW {device.version}</p>}
                </td>
                <td className="truncate px-2 py-1.5" title={device.location || ''}>{device.location || '—'}</td>
                <td className="px-2 py-1.5">
                  <span className="block truncate font-mono" title={device.asset_code || ''}>{device.asset_code || '—'}</span>
                  {device.serial_number && <p className="truncate text-[9px] text-[rgb(var(--muted))]">SN {device.serial_number}</p>}
                  {device.terminal_id && <p className="truncate text-[9px] text-[rgb(var(--muted))]">Term {device.terminal_id}</p>}
                  {device.acceptance_id && <p className="truncate text-[9px] text-[rgb(var(--muted))]">Acc {device.acceptance_id}</p>}
                </td>
                <td className="px-2 py-1.5">
                  {connection.length
                    ? connection.map((detail) => <p key={detail} className="truncate" title={detail}>{detail}</p>)
                    : '—'}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Badge status={device.status || 'unknown'} className="whitespace-nowrap px-1.5 py-0.5 text-[9px] capitalize">{device.status || 'unknown'}</Badge>
                    <span
                      className={device.is_dashboard_visible ? 'status-online-text' : 'text-[rgb(var(--muted))]'}
                      title={device.is_dashboard_visible ? 'Shown on the dashboard' : 'Hidden from the dashboard'}
                    >
                      {device.is_dashboard_visible ? <Eye size={11} /> : <EyeOff size={11} />}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex justify-end">
                    <DeviceActionsMenu device={device} size={14} className="h-7 w-7" />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
