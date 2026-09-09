'use client'

import { Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Router, Activity, Gauge, Clock3, ShieldCheck, WifiOff } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import PingChart from '@/components/dashboard/PingChart'
import DeviceActionsMenu from '@/components/dashboard/DeviceActionsMenu'
import DeviceStatusBadge from '@/components/dashboard/DeviceStatusBadge'
import { Button, Card, EmptyState, Skeleton } from '@/components/ui'
import { useDevicesStore } from '@/stores/devices.store'

function formatTimestamp(value) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })
}

function GatewayDetails() {
  const navigation = useRouter()
  const searchParams = useSearchParams()
  const { branches, devices, generatedAt } = useDevicesStore()
  const branchId = searchParams.get('branch')
  const deviceId = searchParams.get('device')
  const branch = branches.find((item) => String(item.id) === branchId)
  const gateway = devices.find((item) => String(item.id) === deviceId && item.device_type === 'Router')

  const metrics = useMemo(() => {
    const history = gateway?.history || []
    const valid = history.map((item) => item.response_time ?? item.ping_time).filter(Number.isFinite)
    const healthy = valid.filter((value) => value <= 300).length
    const current = gateway?.last_ping_ms ?? gateway?.ping_time
    return {
      current,
      minimum: valid.length ? Math.min(...valid) : null,
      maximum: valid.length ? Math.max(...valid) : null,
      average: valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null,
      availability: history.length ? Math.round((healthy / history.length) * 1000) / 10 : null,
      samples: history.length
    }
  }, [gateway])

  if (!generatedAt) {
    return <div className="mx-auto max-w-[1500px] space-y-4"><Skeleton className="h-16" /><Skeleton className="h-[450px]" /><Skeleton className="h-64" /></div>
  }

  if (!branch || !gateway) {
    return (
      <div className="mx-auto max-w-[1100px]">
        <EmptyState
          icon={<Router />}
          title="Router chart unavailable"
          description="The selected Router is no longer available on the live dashboard. Return to the branch overview and select another chart."
          action={<Button variant="secondary" onClick={() => navigation.push('/dashboard')}><ArrowLeft size={15} /> Back to Dashboard</Button>}
        />
      </div>
    )
  }

  const metricCards = [
    { title: 'Current latency', value: metrics.current == null ? 'No reply' : `${metrics.current} ms`, icon: Activity, tone: metrics.current != null && metrics.current <= 300 ? 'status-online-text bg-nord-14/16' : 'status-warning-text bg-nord-13/18' },
    { title: 'Average latency', value: metrics.average == null ? '—' : `${metrics.average} ms`, icon: Gauge, tone: 'text-nord-10 bg-nord-8/16' },
    { title: 'Healthy responses', value: metrics.availability == null ? '—' : `${metrics.availability}%`, icon: ShieldCheck, tone: 'status-online-text bg-nord-14/16' },
    { title: 'Recorded probes', value: metrics.samples, icon: Clock3, tone: 'text-nord-15 bg-nord-15/15' }
  ]

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="secondary" size="icon" onClick={() => navigation.push('/dashboard')} aria-label="Back to Dashboard"><ArrowLeft size={17} /></Button>
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[rgb(var(--muted))]">{branch.name} · {branch.code}</p>
            <h1 className="truncate text-2xl font-extrabold tracking-tight">Router connection details</h1>
            <p className="mt-0.5 font-mono text-[11px] text-[rgb(var(--muted))]">{gateway.name} · {gateway.ip_address || gateway.ip}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start rounded-xl border bg-[rgb(var(--surface)/.72)] p-2 shadow-sm sm:self-auto">
          <DeviceStatusBadge status={gateway.status} />
          <DeviceActionsMenu device={gateway} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((metric) => {
          const Icon = metric.icon
          return (
            <Card key={metric.title} className="flex items-center gap-3 p-4">
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${metric.tone}`}><Icon size={18} /></div>
              <div className="min-w-0">
                <p className="truncate text-[9px] font-extrabold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">{metric.title}</p>
                <p className="mt-0.5 truncate text-xl font-black tabular-nums">{metric.value}</p>
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col justify-between gap-2 border-b px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-extrabold">Detailed Router ping history</h2>
            <p className="mt-0.5 text-xs text-[rgb(var(--muted))]">Every response through 300 ms is healthy and shown in the green range. Responses above 300 ms are warnings.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-bold tabular-nums text-[rgb(var(--muted))]">
            <span className="rounded-lg bg-[rgb(var(--canvas))] px-2.5 py-1.5">Min {metrics.minimum == null ? '—' : `${metrics.minimum} ms`}</span>
            <span className="rounded-lg bg-[rgb(var(--canvas))] px-2.5 py-1.5">Max {metrics.maximum == null ? '—' : `${metrics.maximum} ms`}</span>
            <span className="status-online-text rounded-lg bg-nord-14/14 px-2.5 py-1.5">Healthy ≤ 300 ms</span>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          {gateway.history?.length ? <PingChart history={gateway.history} detailed /> : <div className="grid h-80 place-items-center rounded-xl border border-dashed text-sm text-[rgb(var(--muted))]">Waiting for Router ping samples…</div>}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b px-5 py-4">
          <h2 className="font-extrabold">Recent probe details</h2>
          <p className="mt-0.5 text-xs text-[rgb(var(--muted))]">Newest monitoring results are listed first.</p>
        </div>
        {gateway.history?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="bg-[rgb(var(--canvas)/.7)] text-[9px] font-extrabold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                <tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Response</th><th className="px-5 py-3">Classification</th><th className="px-5 py-3">Recorded status</th></tr>
              </thead>
              <tbody className="divide-y">
                {[...gateway.history].reverse().slice(0, 20).map((probe, index) => {
                  const responseTime = probe.response_time ?? probe.ping_time
                  const replied = Number.isFinite(responseTime)
                  const healthy = replied && responseTime <= 300
                  return (
                    <tr key={`${probe.checked_at || probe.timestamp || 'probe'}-${index}`} className="hover:bg-[rgb(var(--border)/.18)]">
                      <td className="px-5 py-3 font-medium">{formatTimestamp(probe.checked_at || probe.timestamp)}</td>
                      <td className="px-5 py-3 font-mono font-bold tabular-nums">{replied ? `${responseTime} ms` : 'No reply'}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-extrabold uppercase tracking-wider ${healthy ? 'status-online-text border-nord-14/40 bg-nord-14/15' : replied ? 'status-warning-text border-nord-13/50 bg-nord-13/18' : 'border-nord-11/40 bg-nord-11/12 text-nord-11'}`}>
                          {healthy ? <ShieldCheck size={10} /> : <WifiOff size={10} />}{healthy ? 'Healthy' : replied ? 'Warning' : 'Offline'}
                        </span>
                      </td>
                      <td className="px-5 py-3 capitalize text-[rgb(var(--muted))]">{probe.status || 'unknown'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="p-8 text-center text-sm text-[rgb(var(--muted))]">No probe history is available yet.</div>}
      </Card>
    </div>
  )
}

export default function GatewayPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="mx-auto max-w-[1500px] space-y-4"><Skeleton className="h-16" /><Skeleton className="h-[450px]" /></div>}>
        <GatewayDetails />
      </Suspense>
    </AppShell>
  )
}
