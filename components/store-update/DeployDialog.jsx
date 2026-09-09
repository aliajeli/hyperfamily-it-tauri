'use client'

import { motion } from 'framer-motion'
import { CheckCircle2, ChevronRight, CircleDashed, CloudUpload, Loader2, XCircle } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { cn, collapseSteps, formatBytes, formatDuration } from '@/lib/utils'

const STEP_LABELS = {
  source: 'Selected file',
  connectivity: 'Connection check',
  target: 'Destination path',
  backup: 'Dated backup (Jalali)',
  copy: 'Copying file',
  verify: 'SHA-256 comparison',
  finish: 'Finished'
}

function StepIcon({ status }) {
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-[rgb(var(--primary))]" />
  if (status === 'done') return <CheckCircle2 size={13} className="text-nord-14" />
  if (status === 'failed') return <XCircle size={13} className="text-nord-11" />
  if (status === 'skipped') return <ChevronRight size={13} className="text-nord-13" />
  return <CircleDashed size={13} className="text-[rgb(var(--muted)/.55)]" />
}

/** One narrated pipeline step, with the byte progress bar while copying. */
function StepRow({ entry, progress }) {
  const percent = entry.step === 'copy' && entry.status === 'running' ? progress?.percent ?? 0 : null
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center"><StepIcon status={entry.status} /></span>
        <span className={cn('w-[132px] shrink-0 text-[11.5px] font-bold', entry.status === 'failed' ? 'text-nord-11' : entry.status === 'running' ? 'text-[rgb(var(--primary))]' : 'text-[rgb(var(--text))]')}>
          {STEP_LABELS[entry.step] || entry.step}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-[rgb(var(--muted))]" title={entry.detail}>{entry.detail}</span>
        {percent != null && <span className="shrink-0 font-mono text-[10.5px] font-bold text-[rgb(var(--primary))]">{percent}%</span>}
      </div>
      {percent != null && (
        <div className="ml-7 mt-1 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--border)/.7)]">
          <motion.div className="h-full rounded-full bg-[rgb(var(--primary))]" initial={false} animate={{ width: `${percent}%` }} transition={{ duration: 0.12 }} />
        </div>
      )}
    </div>
  )
}

/**
 * The operations popup: while the run is live it narrates every step of
 * every checkout (ping → backup → copy → verify); when the promise settles
 * it turns into the closing summary — every checkout and whether it passed.
 *
 * Props:
 *  - run: { mode, fileName, destinationPath, checkouts: [{id,name,hostname}],
 *           steps: { [id]: [entry] }, progress: { [id]: {percent} },
 *           activeId, summary }
 *  - running: the deploy call is still in flight
 */
export default function DeployDialog({ open, onOpenChange, run, running, onClose }) {
  if (!run) return null
  const done = Boolean(run.summary) && !running
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!running) onOpenChange(next) }}
      title={done ? 'Deployment summary' : 'Deploying update'}
      description={
        done
          ? `${run.summary.ok} of ${run.summary.total} checkout(s) updated successfully in ${formatDuration(run.summary.durationMs)}.`
          : `${run.fileName} → every checkout’s ${run.destinationPath}`
      }
      className="max-w-3xl"
    >
      <div className="space-y-3">
        {/* Closing summary strip first, so the outcome is visible at a glance. */}
        {done && (
          <div className={cn(
            'flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-bold',
            run.summary.failed > 0 ? 'border-nord-11/40 bg-nord-11/8 text-nord-11' : 'border-nord-14/40 bg-nord-14/10 text-[rgb(var(--text))]'
          )}>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-nord-14" />{run.summary.ok} succeeded</span>
            {run.summary.failed > 0 && <span className="flex items-center gap-1.5"><XCircle size={14} />{run.summary.failed} failed</span>}
            <span className="ml-auto font-semibold text-[rgb(var(--muted))]">{formatBytes(run.summary.results?.reduce((sum, r) => sum + (r.bytes || 0), 0))} deployed · {formatDuration(run.summary.durationMs)}</span>
          </div>
        )}

        <div className="max-h-[55dvh] space-y-2.5 overflow-y-auto pr-1">
          {run.checkouts.map((checkout) => {
            const steps = run.steps[checkout.id] || []
            const result = run.summary?.results?.find((r) => r.checkoutId === checkout.id)
            const isActive = running && run.activeId === checkout.id
            const state = result ? (result.ok ? 'done' : 'failed') : isActive ? 'running' : steps.length ? 'running' : 'pending'
            return (
              <motion.section
                key={checkout.id}
                layout
                className={cn(
                  'rounded-xl border p-3 transition-colors',
                  state === 'running' && 'border-[rgb(var(--primary)/.5)] bg-[rgb(var(--primary)/.05)]',
                  state === 'done' && 'border-nord-14/45 bg-nord-14/6',
                  state === 'failed' && 'border-nord-11/45 bg-nord-11/7',
                  state === 'pending' && 'border-[rgb(var(--border)/.6)] bg-[rgb(var(--surface)/.45)] opacity-75'
                )}
              >
                <header className="flex items-center gap-2">
                  {state === 'running' ? <Loader2 size={15} className="animate-spin text-[rgb(var(--primary))]" />
                    : state === 'done' ? <CheckCircle2 size={15} className="text-nord-14" />
                    : state === 'failed' ? <XCircle size={15} className="text-nord-11" />
                    : <CircleDashed size={15} className="text-[rgb(var(--muted))]" />}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[rgb(var(--text))]">{checkout.name}</span>
                  {/* The IP is the address the deployment actually uses. */}
                  <span className="truncate font-mono text-[10px] text-[rgb(var(--muted))]" title={[checkout.hostname, checkout.ip].filter(Boolean).join(' · ')}>{checkout.ip || checkout.hostname}</span>
                  {result && !result.ok && <span className="shrink-0 rounded-full bg-nord-11/15 px-2 py-0.5 text-[10px] font-bold text-nord-11" title={result.error}>{result.error || 'Failed'}</span>}
                  {result?.ok && <span className="shrink-0 rounded-full bg-nord-14/20 px-2 py-0.5 text-[10px] font-bold text-[#5c7a46]">{formatBytes(result.bytes)} · {formatDuration(result.durationMs)}</span>}
                </header>
                {steps.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-[rgb(var(--border)/.45)] pt-2">
                    {collapseSteps(steps, Boolean(result)).map((entry) => (
                      <StepRow key={`${checkout.id}-${entry.step}`} entry={entry} progress={run.progress[checkout.id]} />
                    ))}
                  </div>
                )}
              </motion.section>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-[rgb(var(--muted))]">
            {running
              ? <span className="inline-flex items-center gap-1.5"><CloudUpload size={12} /> Machines are updated strictly one after another — keep the app open.</span>
              : 'Backups keep the Jalali date prefix (e.g. 14050617-file) and are never overwritten.'}
          </p>
          <Button variant={done ? 'primary' : 'secondary'} size="sm" onClick={onClose} disabled={running}>
            {done ? 'Close' : 'Minimize (keeps running)'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
