'use client'

import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine
} from 'recharts'

function formatTime(timestamp) {
  if (!timestamp) return 'Unknown time'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return String(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  const ping = Number.isFinite(point.value) ? `${point.value} ms` : 'No reply'
  const healthy = Number.isFinite(point.value) && point.value <= 300

  return (
    <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 shadow-xl">
      <p className="text-[10px] font-bold">{formatTime(point.timestamp)}</p>
      <p className={`mt-0.5 text-xs font-extrabold ${healthy ? 'status-online-text' : 'status-warning-text'}`}>{ping}</p>
      <p className="mt-0.5 text-[9px] text-[rgb(var(--muted))]">Healthy threshold: 300 ms</p>
    </div>
  )
}

function StatusDot({ cx, cy, payload }) {
  if (!Number.isFinite(payload?.value)) return null
  const healthy = payload.value <= 300
  return <circle cx={cx} cy={cy} r={3.5} fill={healthy ? '#A3BE8C' : '#EBCB8B'} stroke="rgb(var(--surface))" strokeWidth={1.5} />
}

export default function PingChart({ history = [], compact = false, detailed = false }) {
  const data = history.map((item, index) => ({
    sequence: index + 1,
    value: Number.isFinite(item.response_time) ? item.response_time : Number.isFinite(item.ping_time) ? item.ping_time : null,
    timestamp: item.checked_at || item.timestamp,
    status: item.status
  }))

  const chartHeight = detailed ? 'h-[360px]' : compact ? 'h-16' : 'h-48'
  const showAxes = detailed || !compact

  return (
    <div className={`ping-chart relative w-full overflow-visible ${chartHeight}`} aria-label="Gateway ping history chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={detailed ? { top: 12, right: 18, bottom: 4, left: 4 } : { top: 6, right: 4, bottom: 0, left: 4 }}>
          {detailed ? <CartesianGrid strokeDasharray="4 4" vertical={false} opacity={0.5} /> : null}
          <ReferenceArea y1={0} y2={300} fill="#A3BE8C" fillOpacity={detailed ? 0.1 : 0.07} />
          {showAxes ? (
            <>
              <XAxis
                dataKey="sequence"
                axisLine={false}
                tickLine={false}
                minTickGap={28}
                tickFormatter={(value) => `#${value}`}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={detailed ? 48 : 34}
                domain={[0, (dataMax) => Math.max(350, Number(dataMax || 0) + 40)]}
                tickFormatter={(value) => `${value}`}
              />
            </>
          ) : null}
          <ReferenceLine y={300} stroke="#EBCB8B" strokeDasharray="5 4" strokeWidth={detailed ? 1.5 : 1} />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }}
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 40, pointerEvents: 'none' }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#A3BE8C"
            strokeWidth={detailed ? 2.5 : 2}
            dot={detailed ? <StatusDot /> : false}
            activeDot={{ r: 5, fill: '#88C0D0', stroke: 'rgb(var(--surface))', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={650}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
