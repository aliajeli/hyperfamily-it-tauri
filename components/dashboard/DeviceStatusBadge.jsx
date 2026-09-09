import { CheckCircle2, TriangleAlert, WifiOff, CircleHelp } from 'lucide-react'

const meta = {
  online: {
    label: 'Online',
    icon: CheckCircle2,
    className: 'status-online-text border-nord-14/45 bg-nord-14/16'
  },
  warning: {
    label: 'Warning',
    icon: TriangleAlert,
    className: 'status-warning-text border-nord-13/55 bg-nord-13/20'
  },
  offline: {
    label: 'Offline',
    icon: WifiOff,
    className: 'border-nord-11/45 bg-nord-11/15 text-nord-11'
  },
  unknown: {
    label: 'Unknown',
    icon: CircleHelp,
    className: 'border-nord-3/30 bg-nord-3/10 text-[rgb(var(--muted))]'
  }
}

export default function DeviceStatusBadge({ status = 'unknown', compact = false }) {
  const current = meta[status] || meta.unknown
  const Icon = current.icon

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border font-extrabold uppercase tracking-[0.08em] ${compact ? 'gap-1 px-1.5 py-0.5 text-[7px]' : 'gap-1.5 px-2 py-1 text-[8px]'} ${current.className}`}>
      <Icon size={compact ? 9 : 11} strokeWidth={2.4} />
      {current.label}
    </span>
  )
}
