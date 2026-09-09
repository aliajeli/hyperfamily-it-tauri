'use client'

import { motion } from 'framer-motion'
import { CloudUpload, MonitorSmartphone, PackageSearch, RefreshCw, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Three bouncing dots — the wait indicator inside the “Checking…” pill. */
function CheckingDots() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="h-[5px] w-[5px] rounded-full bg-[rgb(var(--primary))]"
          animate={{ y: [0, -3, 0], opacity: [0.35, 1, 0.35], scale: [0.85, 1.15, 0.85] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.13, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}

/** Version pill in every state, including the animated “Checking…” wait. */
function VersionPill({ version }) {
  const state = version?.state || 'checking'
  if (state === 'checking') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-[rgb(var(--primary)/.12)] px-2.5 py-1 text-[11px] font-bold text-[rgb(var(--primary))]">
        Checking
        <CheckingDots />
      </span>
    )
  }
  if (state === 'ok') {
    // Where the number came from matters: only the Control Panel entry is
    // authoritative, the other two routes can lag behind an update.
    const provenance = {
      agent: 'Read locally by the running HyperFamily Agent (Programs and Features)',
      'control-panel': 'Read from Programs and Features',
      wmi: 'Read from the live uninstall registry via WMI (Programs and Features version)',
      'registry-backup': 'Read from the registry backup — Remote Registry was stopped, so this may be slightly out of date',
      file: 'Read from the executable — this is the file version, not the Control Panel entry'
    }[version.source] || 'Installed version'
    const hint = [
      provenance,
      version.pingTime != null ? `Responded in ${version.pingTime} ms` : null,
      version.icmp === false ? 'Ping is filtered on this host; reached over SMB' : null
    ].filter(Boolean).join('\n')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-nord-14/20 px-2.5 py-1 font-mono text-[11px] font-bold text-[#5c7a46]" title={hint}>
        <span className="h-1.5 w-1.5 rounded-full bg-nord-14" />
        v{version.version}
        {version.stale && <span className="font-sans text-[9px] font-bold text-[#8b6e1c]" title={provenance}>~</span>}
      </span>
    )
  }
  const looks = {
    'agent-not-running': { className: 'bg-nord-13/20 text-[#8b6e1c]', dot: 'bg-nord-13', label: 'Agent is not running' },
    offline: { className: 'bg-nord-11/15 text-nord-11', dot: 'bg-nord-11', label: 'Offline' },
    'not-found': { className: 'bg-nord-13/20 text-[#8b6e1c]', dot: 'bg-nord-13', label: 'Not installed' },
    'no-host': { className: 'bg-nord-3/15 text-[rgb(var(--muted))]', dot: 'bg-nord-3', label: 'No address' },
    error: { className: 'bg-nord-11/15 text-nord-11', dot: 'bg-nord-11', label: 'Check failed' }
  }
  const look = looks[state] || looks.error
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold', look.className)} title={version?.error || version?.detail || undefined}>
      <span className={cn('h-1.5 w-1.5 rounded-full', look.dot)} />
      {look.label}
    </span>
  )
}

/**
 * One checkout: live version (or the animated “Checking…” placeholder),
 * its address, a recheck action and a deploy action. `deployBusy` disables
 * both actions while that checkout is being updated.
 */
export default function CheckoutCard({ checkout, version, onRecheck, onDeploy, onInspect, onImportAgent, agentBusy = false, deployBusy = false, anyDeployRunning = false }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl border border-[rgb(var(--border)/.65)] bg-[rgb(var(--surface)/.6)] p-3 transition-colors hover:border-[rgb(var(--primary)/.35)]"
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))]">
          <MonitorSmartphone size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-[rgb(var(--text))]" title={checkout.name}>{checkout.name}</div>
          {/* The IP is what the app connects to, so it is what we display. */}
          <div className="truncate font-mono text-[10.5px] text-[rgb(var(--muted))]" title={[checkout.hostname, checkout.ip].filter(Boolean).join(' · ')}>{checkout.ip || checkout.hostname || 'no address'}</div>
        </div>
        {onInspect && (
          <button
            type="button"
            onClick={() => onInspect(checkout)}
            disabled={deployBusy || agentBusy}
            aria-label="List installed programs"
            title="Show everything installed on this checkout — use it to find the exact product name"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[rgb(var(--muted))] transition hover:bg-[rgb(var(--border)/.55)] hover:text-[rgb(var(--text))] disabled:opacity-40"
          >
            <PackageSearch size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onRecheck(checkout)}
          disabled={deployBusy || agentBusy || version?.state === 'checking'}
          aria-label="Recheck version"
          title="Recheck Store Commerce version"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[rgb(var(--muted))] transition hover:bg-[rgb(var(--border)/.55)] hover:text-[rgb(var(--text))] disabled:opacity-40"
        >
          <RefreshCw size={13} className={version?.state === 'checking' ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <VersionPill version={version} />
        <button type="button" onClick={() => onImportAgent(checkout)} disabled={anyDeployRunning}
          className="inline-flex items-center gap-1 rounded-lg bg-[rgb(var(--primary)/.12)] px-2 py-1 text-[10.5px] font-bold text-[rgb(var(--primary))] disabled:opacity-40"
          title="Compare SHA-256, import the agent and configure automatic startup">
          <ShieldCheck size={12} />{agentBusy ? 'Importing…' : 'Import Agent'}
        </button>
        <button
          type="button"
          onClick={() => onDeploy(checkout)}
          disabled={anyDeployRunning}
          className="inline-flex items-center gap-1 rounded-lg bg-[rgb(var(--primary)/.12)] px-2 py-1 text-[10.5px] font-bold text-[rgb(var(--primary))] transition hover:bg-[rgb(var(--primary)/.22)] disabled:opacity-40"
          title="Deploy the selected file to this checkout"
        >
          <CloudUpload size={12} />
          Deploy
        </button>
      </div>
    </motion.div>
  )
}
