'use client'

import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'

export default function AgentImportDialog({ run, onClose }) {
  return (
    <Dialog open={run.open} onOpenChange={(open) => { if (!open && !run.running) onClose() }} title="Import Agent" description="C:\Agent · Automatic Windows Service · SHA-256 verified" className="max-w-2xl">
      <div className="space-y-3">
        <p className="text-xs text-[rgb(var(--muted))]">Identical EXEs are not copied again. Slow branch transfers can continue for up to 30 minutes per file operation while making progress; 2 minutes without I/O progress stops the operation. The service is configured to start before Login and must produce a fresh heartbeat before import succeeds.</p>
        <div className="max-h-[55vh] space-y-2 overflow-auto">
          {run.targets.map((checkout) => {
            const result = run.results.find((entry) => entry.checkoutId === checkout.id)
            const steps = run.steps[checkout.id] || []
            const progress = !result && steps.at(-1)?.progress
            const percent = progress?.totalBytes > 0 ? Math.min(100, Math.floor(progress.bytes * 100 / progress.totalBytes)) : 0
            return (
              <div key={checkout.id} className="rounded-xl border border-[rgb(var(--border))] p-3 text-xs">
                <div className="flex items-center gap-2 font-bold">
                  {result ? (result.ok ? <CheckCircle2 size={15} className="text-nord-14" /> : <XCircle size={15} className="text-nord-11" />) : steps.length ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                  <span>{checkout.name}</span>
                  <span className="ml-auto font-mono text-[rgb(var(--muted))]"> · {checkout.ip || checkout.hostname}</span>
                </div>
                <p className="mt-2 break-words text-[rgb(var(--muted))]">{result ? (result.ok ? `${result.copied ? 'Copied and verified' : 'SHA-256 matches — copy skipped'} · Agent is running` : result.error) : steps.at(-1)?.detail || 'Waiting…'}</p>
                {progress && <div role="progressbar" aria-label={`Agent file operation on ${checkout.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--border))]">
                  <div className="h-full bg-[rgb(var(--primary))] transition-all" style={{ width: `${percent}%` }} />
                </div>}
                {steps.length > 0 && <details className="mt-2 text-[11px]"><summary className="cursor-pointer">Import details</summary><ol className="mt-1 space-y-1 break-words text-[rgb(var(--muted))]">{steps.map((entry, index) => <li key={index}>{entry.step}: {entry.detail}</li>)}</ol></details>}
              </div>
            )
          })}
        </div>
        {run.summary && <p className="text-sm font-bold">{run.summary.ok} successful · {run.summary.failed} failed · {run.summary.total} total</p>}
        <div className="flex justify-end"><Button variant="secondary" disabled={run.running} onClick={onClose}>{run.running ? 'Import in progress…' : 'Close'}</Button></div>
      </div>
    </Dialog>
  )
}
