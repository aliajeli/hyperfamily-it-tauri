'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, PackageSearch, Search } from 'lucide-react'
import { Button, Dialog, Input, Skeleton } from '@/components/ui'
import { getApi } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Diagnostic view of everything in Programs and Features on one checkout.
 *
 * When the version cannot be read, the cause is almost always that the product
 * is registered under a different display name than the one configured. Rather
 * than guessing, this shows the machine's real list and lets the operator click
 * the right entry to adopt its exact name.
 */
export default function InstalledProgramsDialog({ open, onOpenChange, checkout, onAdopt }) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open || !checkout) return
    let alive = true
    setState({ loading: true, data: null, error: null })
    setQuery('')
    getApi().storeUpdate.installed({ checkout })
      .then((data) => { if (alive) setState({ loading: false, data, error: null }) })
      .catch((error) => { if (alive) setState({ loading: false, data: null, error: error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') }) })
    return () => { alive = false }
  }, [open, checkout])

  const rows = useMemo(() => {
    const all = state.data?.programs || []
    const needle = query.trim().toLowerCase()
    if (!needle) return all
    return all.filter((program) => program.name.toLowerCase().includes(needle) || (program.publisher || '').toLowerCase().includes(needle))
  }, [state.data, query])

  const configured = state.data?.configuredName || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Installed programs" description={checkout ? `Programs and Features as reported by ${checkout.name}` : ''} className="max-w-2xl">
      <div className="space-y-2.5">
        {state.loading && <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div>}

        {state.error && (
          <div className="flex items-start gap-2 rounded-xl border border-nord-11/35 bg-nord-11/10 p-2.5 text-[11.5px] leading-relaxed text-nord-11">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}

        {state.data && (
          <>
            <p className="text-[11px] text-[rgb(var(--muted))]">
              {state.data.source === 'agent' ? 'Source: running local Agent (Programs and Features).' : state.data.source === 'wmi' ? 'Source: live registry via WMI (Programs and Features).' : state.data.source === 'registry-backup' ? 'Source: registry backup — versions may be outdated.' : 'Source: live registry (Programs and Features).'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
                <Input className="pl-8" placeholder="Filter by name or publisher…" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <span className="shrink-0 rounded-full bg-[rgb(var(--border)/.6)] px-2.5 py-1 text-[10.5px] font-bold text-[rgb(var(--muted))]">
                {rows.length} of {state.data.total}
              </span>
            </div>

            <p className="rounded-xl border border-[rgb(var(--border)/.55)] bg-[rgb(var(--surface)/.45)] px-2.5 py-2 text-[10.5px] leading-relaxed text-[rgb(var(--muted))]">
              Looking for <b className="font-mono">{configured}</b>
              {state.data.match
                ? <> — matched <b className="font-mono">{state.data.match.name}</b> v{state.data.match.version || 'unknown'}.</>
                : <> — no entry matches. Click the correct program below to use its exact name everywhere.</>}
              {state.data.source === 'registry-backup' && ' Read from the registry backup, so it may be slightly out of date.'}
            </p>

            <div className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
              {rows.map((program, index) => {
                const isMatch = state.data.match?.name === program.name
                return (
                  <button
                    key={`${program.name}-${index}`}
                    type="button"
                    onClick={() => onAdopt?.(program.name)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition',
                      isMatch
                        ? 'border-nord-14/45 bg-nord-14/10'
                        : 'border-transparent hover:border-[rgb(var(--border))] hover:bg-[rgb(var(--border)/.35)]'
                    )}
                    title="Use this exact name for the version check"
                  >
                    <PackageSearch size={13} className={cn('shrink-0', isMatch ? 'text-nord-14' : 'text-[rgb(var(--muted))]')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-bold text-[rgb(var(--text))]">{program.name}</span>
                      {program.publisher && <span className="block truncate text-[10px] text-[rgb(var(--muted))]">{program.publisher}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] font-bold text-[rgb(var(--muted))]">{program.version || '—'}</span>
                  </button>
                )
              })}
              {rows.length === 0 && <p className="py-6 text-center text-[11.5px] text-[rgb(var(--muted))]">Nothing matches that filter.</p>}
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </div>
    </Dialog>
  )
}
