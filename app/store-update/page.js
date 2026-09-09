'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Building2, CloudUpload, FileUp, HardDriveDownload, RefreshCw, Settings2, ShoppingCart, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import AppShell from '@/components/layout/AppShell'
import CheckoutCard from '@/components/store-update/CheckoutCard'
import AgentImportDialog from '@/components/store-update/AgentImportDialog'
import DeployDialog from '@/components/store-update/DeployDialog'
import InstalledProgramsDialog from '@/components/store-update/InstalledProgramsDialog'
import { Button, Card, CardContent, EmptyState, Skeleton } from '@/components/ui'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { getApi } from '@/lib/api'
import { formatDuration } from '@/lib/utils'

/** Checkout devices grouped and ordered under their branch name. */
function groupCheckouts(branches, devices) {
  const byBranch = new Map(branches.map((branch) => [branch.id, branch]))
  const groups = new Map()
  for (const device of devices) {
    if (device.device_type !== 'Checkout') continue
    const branch = byBranch.get(device.branch_id) || { id: 0, name: 'Unassigned', code: '—' }
    if (!groups.has(branch.id)) groups.set(branch.id, { branch, checkouts: [] })
    groups.get(branch.id).checkouts.push(device)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      checkouts: group.checkouts.sort((a, b) => (a.checkout_number ?? 999) - (b.checkout_number ?? 999) || a.name.localeCompare(b.name))
    }))
    .sort((a, b) => a.branch.name.localeCompare(b.branch.name))
}

export default function StoreUpdatePage() {
  const confirm = useConfirm()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])
  const [settings, setSettings] = useState(null)
  // checkoutId → { state: checking|ok|offline|not-found|error|no-host, version?, pingTime?, … }
  const [versions, setVersions] = useState({})
  const [file, setFile] = useState(null) // { path, name }
  const [deploying, setDeploying] = useState(false)
  const [agentRun, setAgentRun] = useState({ open: false, running: false, targets: [], results: [], steps: {}, summary: null })
  const agentBusyRef = useRef(false)
  const [dialog, setDialog] = useState({ open: false, run: null })
  // Diagnostic list of everything installed on one checkout.
  const [inspect, setInspect] = useState({ open: false, checkout: null })
  // Live deploy narration: checkoutId → step list / progress
  const [steps, setSteps] = useState({})
  const [progress, setProgress] = useState({})
  const sweepStarted = useRef(false)
  const dialogRef = useRef(dialog)
  dialogRef.current = dialog

  const allCheckouts = useMemo(() => groups.flatMap((group) => group.checkouts), [groups])
  const anyDeployRunning = deploying || agentRun.running

  /* ------------------------------------------------ data + subscriptions */
  useEffect(() => {
    let alive = true
    const api = getApi()
    const unsubs = [
      api.storeUpdate.onAgentStep((entry) => {
        setAgentRun((previous) => {
          const entries = previous.steps[entry.checkoutId] || []
          const next = entry.progress && entries.at(-1)?.progress && entries.at(-1).step === entry.step
            ? [...entries.slice(0, -1), entry] : [...entries, entry]
          return { ...previous, steps: { ...previous.steps, [entry.checkoutId]: next } }
        })
      }),
      api.storeUpdate.onVersion((result) => {
        setVersions((previous) => ({ ...previous, [result.checkoutId]: result }))
      }),
      api.storeUpdate.onStep((entry) => {
        setSteps((previous) => ({ ...previous, [entry.checkoutId]: [...(previous[entry.checkoutId] || []), entry] }))
      }),
      api.storeUpdate.onProgress((entry) => {
        setProgress((previous) => ({ ...previous, [entry.checkoutId]: entry }))
      })
    ]
    Promise.all([api.settings.get(), api.branches.list(), api.devices.list()])
      .then(([loadedSettings, branches, devices]) => {
        if (!alive) return
        setSettings(loadedSettings)
        setGroups(groupCheckouts(branches || [], devices || []))
        setLoading(false)
      })
      .catch((error) => {
        if (!alive) return
        toast.error(error.message)
        setLoading(false)
      })
    return () => { alive = false; unsubs.forEach((unsub) => unsub?.()) }
  }, [])

  /* -------------------------------------------------------- version scan */
  const runSweep = useCallback((checkouts) => {
    if (!checkouts.length) return
    setVersions((previous) => {
      const next = { ...previous }
      for (const checkout of checkouts) next[checkout.id] = { state: 'checking' }
      return next
    })
    getApi().storeUpdate.versions({ checkouts })
      .then(() => toast.success(`Version sweep finished for ${checkouts.length} checkout(s)`))
      .catch((error) => {
        setVersions((previous) => {
          const next = { ...previous }
          for (const checkout of checkouts) if (next[checkout.id]?.state === 'checking') next[checkout.id] = { state: 'error', error: error.message }
          return next
        })
        toast.error(error.message)
      })
  }, [])

  // Automatic sweep on first load — the page's whole point is seeing every
  // checkout's Store Commerce version immediately.
  useEffect(() => {
    if (sweepStarted.current || !settings || allCheckouts.length === 0) return
    sweepStarted.current = true
    runSweep(allCheckouts)
  }, [settings, allCheckouts, runSweep])

  /** Adopt the exact program name an operator picked from the diagnostic list. */
  const adoptProgramName = useCallback(async (name) => {
    try {
      const next = await getApi().settings.save({ store_program_name: name })
      setSettings(next)
      setInspect({ open: false, checkout: null })
      toast.success(`Now looking for “${name}” — rechecking every checkout`)
      runSweep(allCheckouts)
    } catch (error) {
      toast.error(error.message)
    }
  }, [allCheckouts, runSweep])

  const recheck = useCallback(async (checkout) => {
    if (!settings) return
    setVersions((previous) => ({ ...previous, [checkout.id]: { state: 'checking' } }))
    try {
      const result = await getApi().storeUpdate.version({ checkout })
      setVersions((previous) => ({ ...previous, [checkout.id]: result }))
      if (result.state === 'ok') toast.success(`${checkout.name}: Store Commerce v${result.version}`)
      else if (result.state === 'offline') toast.error(`${checkout.name} is offline`)
    } catch (error) {
      setVersions((previous) => ({ ...previous, [checkout.id]: { state: 'error', error: error.message } }))
      toast.error(error.message)
    }
  }, [settings])

  const importAgents = async (targets, all = false) => {
    if (agentBusyRef.current || deploying || !targets.length) return
    const accepted = await confirm({
      title: all ? `Import Agent to all ${targets.length} checkout(s)?` : `Import Agent to ${targets[0].name}?`,
      description: 'The bundled EXE will be compared using SHA-256 and copied to C:\\Agent only if missing or different. A Windows Service will be installed/started with Automatic startup before Login. Existing agents are briefly restarted. Target access must have administrator permissions.',
      confirmLabel: all ? 'Import Agent to all' : 'Import Agent', destructive: false
    })
    if (!accepted || agentBusyRef.current) return
    agentBusyRef.current = true
    setAgentRun({ open: true, running: true, targets, results: [], steps: {}, summary: null })
    try {
      const api = getApi().storeUpdate
      const summary = all
        ? await api.importAgentAll({ checkouts: targets })
        : await api.importAgent({ checkout: targets[0] }).then((result) => ({ total: 1, ok: result.ok ? 1 : 0, failed: result.ok ? 0 : 1, results: [result] }))
      setAgentRun((previous) => ({ ...previous, running: false, results: summary.results, summary }))
      if (summary.failed) toast.error(`${summary.failed} agent import(s) failed — see details`)
      else toast.success(`Agent is running on ${summary.ok} checkout(s)`)
      runSweep(targets)
    } catch (error) {
      setAgentRun((previous) => ({ ...previous, running: false, results: targets.map((checkout) => ({ checkoutId: checkout.id, ok: false, error: error.message })) }))
      toast.error(error.message)
    } finally { agentBusyRef.current = false }
  }

  /* --------------------------------------------------------- file picker */
  const pickFile = async () => {
    try {
      const picked = await getApi().dialog.selectFile({ title: 'Choose the update file to deploy' })
      if (picked) {
        setFile({ path: picked, name: picked.split(/[\\/]/).pop() })
        toast.success(`Selected ${picked.split(/[\\/]/).pop()}`)
      }
    } catch (error) {
      toast.error(error.message)
    }
  }

  /* ------------------------------------------------------------ deploys */
  const beginRun = (mode, checkouts) => {
    setSteps({})
    setProgress({})
    setDialog({
      open: true,
      run: {
        mode,
        fileName: file.name,
        destinationPath: settings.store_update_path,
        checkouts,
        activeId: checkouts[0]?.id,
        summary: null
      }
    })
    setDeploying(true)
  }

  const finishRun = (summary) => {
    setDeploying(false)
    setDialog((previous) => previous.run ? { open: true, run: { ...previous.run, summary } } : previous)
    if (summary.failed > 0) toast.error(`${summary.failed} of ${summary.total} checkout(s) failed — see the summary for details`)
    else toast.success(`Deployment finished: ${summary.ok}/${summary.total} checkout(s) updated in ${formatDuration(summary.durationMs)}`)
  }

  const deployOne = async (checkout) => {
    if (anyDeployRunning) return
    if (!file) { toast.error('Choose the update file first') ; return }
    beginRun('single', [checkout])
    try {
      const result = await getApi().storeUpdate.deploy({ checkout, source: file.path, destinationPath: settings.store_update_path })
      finishRun({ runId: `single-${Date.now()}`, total: 1, ok: result.ok ? 1 : 0, failed: result.ok ? 0 : 1, results: [result], durationMs: result.durationMs || 0 })
    } catch (error) {
      setDeploying(false)
      setDialog((previous) => ({ ...previous, open: false }))
      toast.error(error.message)
    }
  }

  const deployAll = async () => {
    if (anyDeployRunning) return
    if (!file) { toast.error('Choose the update file first'); return }
    if (!allCheckouts.length) { toast.error('No checkout is registered in the directory'); return }
    const onlineTargets = allCheckouts.filter((checkout) => checkout.hostname || checkout.ip)
    const accepted = await confirm({
      title: `Deploy to ${onlineTargets.length} checkout(s)?`,
      description: `“${file.name}” will be sent to ${settings.store_update_path} on every checkout — strictly one after another. Existing files are kept as a Jalali-dated backup (14050617-name).`,
      confirmLabel: 'Deploy to all',
      destructive: false
    })
    if (!accepted) return
    beginRun('all', onlineTargets)
    try {
      const summary = await getApi().storeUpdate.deployAll({ checkouts: onlineTargets, source: file.path, destinationPath: settings.store_update_path })
      finishRun(summary)
    } catch (error) {
      setDeploying(false)
      setDialog((previous) => ({ ...previous, open: false }))
      toast.error(error.message)
    }
  }

  // Track which checkout is currently receiving (the one with the newest step).
  useEffect(() => {
    if (!deploying) return
    const ids = Object.keys(steps)
    if (!ids.length) return
    const activeId = Number(ids[ids.length - 1])
    setDialog((previous) => (previous.run && previous.run.activeId !== activeId ? { ...previous, run: { ...previous.run, activeId } } : previous))
  }, [steps, deploying])

  /* ----------------------------------------------------------------- UI */
  return (
    <AppShell>
      <div className="mx-auto max-w-[1600px] space-y-3">
        <div>
          <h1 className="page-title">Update Store App</h1>
          <p className="page-subtitle">Store Commerce versions across every checkout, and verified file deployment with Jalali-dated backups.</p>
        </div>

        {/* Toolbar: update file, recheck-all and deploy-to-all. */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[rgb(var(--primary)/.13)] text-[rgb(var(--primary))]"><HardDriveDownload size={18} /></span>
              <div className="min-w-0 flex-1">
                {file ? (
                  <>
                    <div className="truncate text-[13px] font-bold text-[rgb(var(--text))]">{file.name}</div>
                    <div className="truncate font-mono text-[10.5px] text-[rgb(var(--muted))]" title={file.path}>{file.path}</div>
                  </>
                ) : (
                  <>
                    <div className="text-[13px] font-bold text-[rgb(var(--text))]">No update file selected</div>
                    <div className="text-[10.5px] text-[rgb(var(--muted))]">Destination on every checkout: <span className="font-mono">{settings?.store_update_path || '…'}</span></div>
                  </>
                )}
              </div>
              {file && (
                <button type="button" aria-label="Clear selected file" onClick={() => setFile(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[rgb(var(--muted))] transition hover:bg-[rgb(var(--border)/.55)] hover:text-nord-11">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => importAgents(allCheckouts, true)} disabled={anyDeployRunning || !allCheckouts.length}>
                <ShieldCheck size={14} /> Import Agent to all
              </Button>
              <Button variant="secondary" size="sm" onClick={pickFile} disabled={anyDeployRunning}>
                <FileUp size={14} />
                {file ? 'Change file…' : 'Select file…'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => runSweep(allCheckouts)} disabled={anyDeployRunning || !allCheckouts.length || Object.values(versions).some((v) => v.state === 'checking')}>
                <RefreshCw size={14} />
                Recheck all
              </Button>
              <Button size="sm" onClick={deployAll} disabled={anyDeployRunning || !file || !allCheckouts.length}>
                <CloudUpload size={14} />
                Deploy to all
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* How the run proceeds — shown up front so the operator knows the plan. */}
        {settings && (
          <p className="rounded-xl border border-[rgb(var(--border)/.55)] bg-[rgb(var(--surface)/.45)] px-3 py-2 text-[11px] leading-relaxed text-[rgb(var(--muted))]">
            <Settings2 size={12} className="mr-1 inline-block" />
            The local Agent reads the Store Commerce version from Programs and Features. Import installs it in C:\Agent as an automatic Windows Service. Missing/stopped agents show “Agent is not running”. Update files land in <b className="font-mono">{settings.store_update_path}</b> (changeable in Settings → Store App).
            Checkouts in another domain are reached with the account from Settings → Store App → Target access.
            Per checkout: connection check → dated backup of the existing file (<b className="font-mono">14050617-name</b>) → copy → SHA-256 proof, with delete-and-retry on mismatch.
          </p>
        )}

        {loading ? (
          <div className="space-y-3"><Skeleton className="h-9 w-64" /><div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[104px]" />)}</div></div>
        ) : allCheckouts.length === 0 ? (
          <EmptyState
            icon={<ShoppingCart size={26} />}
            title="No checkout registered"
            description="Add checkout devices under Branches &amp; devices first — every registered checkout then appears here grouped by its branch."
          />
        ) : (
          groups.map((group) => (
            <section key={group.branch.id} className="space-y-2">
              <header className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))]"><Building2 size={14} /></span>
                <h2 className="text-sm font-bold text-[rgb(var(--text))]">{group.branch.name}</h2>
                <span className="rounded-full bg-[rgb(var(--border)/.6)] px-2 py-0.5 text-[10px] font-bold text-[rgb(var(--muted))]">{group.branch.code}</span>
                <span className="text-[10.5px] text-[rgb(var(--muted))]">{group.checkouts.length} checkout{group.checkouts.length !== 1 ? 's' : ''}</span>
              </header>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                <AnimatePresence initial={false}>
                  {group.checkouts.map((checkout) => (
                    <CheckoutCard
                      key={checkout.id}
                      checkout={checkout}
                      version={versions[checkout.id] || { state: 'checking' }}
                      onRecheck={recheck}
                      onImportAgent={(target) => importAgents([target])}
                      agentBusy={agentRun.running && agentRun.targets.some((target) => target.id === checkout.id)}
                      onDeploy={deployOne}
                      onInspect={(target) => setInspect({ open: true, checkout: target })}
                      anyDeployRunning={anyDeployRunning}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          ))
        )}
      </div>

      <AgentImportDialog run={agentRun} onClose={() => setAgentRun((previous) => ({ ...previous, open: false }))} />

      <InstalledProgramsDialog
        open={inspect.open}
        onOpenChange={(open) => setInspect((previous) => ({ ...previous, open }))}
        checkout={inspect.checkout}
        onAdopt={adoptProgramName}
      />

      <DeployDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((previous) => ({ ...previous, open }))}
        run={dialog.run ? { ...dialog.run, steps, progress } : null}
        running={deploying}
        onClose={() => setDialog((previous) => ({ ...previous, open: false }))}
      />
    </AppShell>
  )
}
