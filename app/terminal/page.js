'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Building2, Cable, Circle, Copy, Loader2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Power, RefreshCw, TerminalSquare, Type, X } from 'lucide-react'
import { toast } from 'sonner'
import AppShell from '@/components/layout/AppShell'
import SnippetPanel from '@/components/terminal/SnippetPanel'
import TerminalScreen from '@/components/terminal/TerminalScreen'
import { Button, EmptyState, Skeleton } from '@/components/ui'
import { getApi } from '@/lib/api'
import { MONO_FONTS, monoStack, normalizeTerminalFontSize, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '@/lib/typography'
import { cn } from '@/lib/utils'

// --success / --danger are not defined anywhere in the stylesheet, so the dot
// used to resolve to an invalid colour and fall back to black. Use the Nord
// palette the rest of the app relies on for status colours.
const STATE_STYLES = {
  idle: { label: 'Idle', color: 'rgb(var(--muted))' },
  connecting: { label: 'Connecting', color: 'rgb(var(--primary))' },
  connected: { label: 'Connected', color: '#A3BE8C' },
  error: { label: 'Error', color: '#BF616A' },
  closed: { label: 'Disconnected', color: 'rgb(var(--muted))' }
}

// The user asked for 8–16; the range is generated so the bounds live in one place.
const FONT_SIZES = Array.from(
  { length: TERMINAL_FONT_SIZE_MAX - TERMINAL_FONT_SIZE_MIN + 1 },
  (_, index) => TERMINAL_FONT_SIZE_MIN + index
)

function TerminalWorkspaceInner() {
  const searchParams = useSearchParams()
  // getApi() is undefined while the page is prerendered, so every dereference
  // below is optional; the real bridge exists from the first client render on.
  const api = getApi()

  const [branches, setBranches] = useState([])
  const [snippets, setSnippets] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeBranchId, setActiveBranchId] = useState(null)
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState({ state: 'idle', message: '' })
  const [fontSize, setFontSize] = useState(13)
  const [fontFamily, setFontFamily] = useState(MONO_FONTS[0].id)
  const [fullscreen, setFullscreen] = useState(false)
  // Snippets stay available in fullscreen, but hidden by default so the
  // console gets the whole width until they are actually wanted.
  const [showSnippets, setShowSnippets] = useState(false)
  const [grid, setGrid] = useState({ cols: 80, rows: 24 })
  const [busyDeviceId, setBusyDeviceId] = useState(null)
  const sessionRef = useRef(null)
  const autoConnectedRef = useRef(false)

  sessionRef.current = session

  const terminalApi = useMemo(() => api?.terminal, [api])

  const loadSnippets = useCallback(async () => {
    try { setSnippets(await api.snippets.list()) } catch (error) { toast.error(error.message) }
  }, [api])

  const load = useCallback(async () => {
    if (!terminalApi) return
    try {
      const [targets, snippetRows, settings] = await Promise.all([terminalApi.targets(), api.snippets.list(), api.settings.get().catch(() => null)])
      if (settings?.terminal_font_size) setFontSize(normalizeTerminalFontSize(settings.terminal_font_size))
      if (settings?.terminal_font_family) setFontFamily(settings.terminal_font_family)
      setBranches(targets)
      setSnippets(snippetRows)
      setActiveBranchId((current) => (current && targets.some((branch) => branch.id === current) ? current : targets[0]?.id || null))
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [terminalApi, api])

  useEffect(() => { load() }, [load])

  // Persist the font choices so the next visit opens the way it was left.
  // Failures are ignored: the browser demo has no settings table.
  useEffect(() => {
    if (loading) return
    api.settings.save({ terminal_font_size: fontSize, terminal_font_family: fontFamily }).catch(() => {})
  }, [fontSize, fontFamily, loading, api])

  // F11 toggles the fullscreen console, Escape leaves it. Both are ignored
  // while typing into an input so they cannot fire from the snippet editor.
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (event.key === 'F11' && !typing) { event.preventDefault(); setFullscreen((value) => !value) }
      else if (event.key === 'Escape' && !typing) setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Status stream from the main process.
  useEffect(() => {
    if (!terminalApi) return undefined
    const unsubscribe = terminalApi.onStatus((payload) => {
      if (sessionRef.current && payload.sessionId !== sessionRef.current.sessionId) return
      setStatus({ state: payload.state, message: payload.message || '' })
      if (payload.state === 'error') toast.error(payload.message || 'The session reported an error')
    })
    return unsubscribe
  }, [terminalApi])

  const connect = useCallback(async (device) => {
    setBusyDeviceId(device.id)
    try {
      if (sessionRef.current) { await terminalApi.close(sessionRef.current.sessionId).catch(() => {}) }
      setStatus({ state: 'connecting', message: `Reaching ${device.ip}…` })
      const opened = await terminalApi.open({ deviceId: device.id, cols: grid.cols, rows: grid.rows })
      setSession({ ...opened, deviceId: device.id, location: device.location, model: device.model })
    } catch (error) {
      setStatus({ state: 'error', message: error.message })
      toast.error(error.message)
    } finally {
      setBusyDeviceId(null)
    }
  }, [terminalApi, grid.cols, grid.rows])

  const disconnect = useCallback(async () => {
    if (!sessionRef.current) return
    await terminalApi.close(sessionRef.current.sessionId).catch(() => {})
    setStatus({ state: 'closed', message: 'Closed by the operator' })
  }, [terminalApi])

  useEffect(() => () => { if (sessionRef.current) terminalApi?.close(sessionRef.current.sessionId).catch(() => {}) }, [terminalApi])

  // Deep link from the inventory / device kebab menu: /terminal?device=<id>
  useEffect(() => {
    if (autoConnectedRef.current || !branches.length) return
    const deviceId = Number(searchParams.get('device'))
    if (!deviceId) return
    for (const branch of branches) {
      const match = branch.switches.find((item) => item.id === deviceId)
      if (match) {
        autoConnectedRef.current = true
        setActiveBranchId(branch.id)
        connect(match)
        return
      }
    }
    autoConnectedRef.current = true
  }, [branches, searchParams, connect])

  const activeBranch = branches.find((branch) => branch.id === activeBranchId) || null
  const live = session && (status.state === 'connecting' || status.state === 'connected')

  // Snippets may hold a whole block of configuration. Lines are sent one at a
  // time with a short pause so slow switch CLIs do not drop characters.
  const runSnippet = async (snippet) => {
    if (!session || status.state !== 'connected') { toast.error('Connect to a switch first'); return }
    const lines = String(snippet.command || '').replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim().length)
    if (!lines.length) return
    const { sessionId } = session
    for (const [index, line] of lines.entries()) {
      if (sessionRef.current?.sessionId !== sessionId) return
      await terminalApi.write({ sessionId, data: `${line}\r` })
      if (index < lines.length - 1) await new Promise((resolve) => setTimeout(resolve, 120))
    }
    if (lines.length > 1) toast.success(`Sent ${lines.length} lines`)
  }

  const saveSnippet = async (draft) => {
    // Normalise line endings but keep the internal newlines: multi-line
    // snippets are stored verbatim so a whole config block can be replayed.
    const command = String(draft.command || '').replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '')
    await api.snippets.save({ id: draft.id || undefined, name: draft.name.trim(), command, description: draft.description?.trim() || '' })
    await loadSnippets()
    toast.success(draft.id ? 'Snippet updated' : 'Snippet saved')
  }

  const deleteSnippet = async (snippet) => {
    try {
      await api.snippets.remove(snippet.id)
      await loadSnippets()
      toast.success(`Removed “${snippet.name}”`)
    } catch (error) { toast.error(error.message) }
  }

  const statusStyle = STATE_STYLES[status.state] || STATE_STYLES.idle

  return (
    <AppShell>
      <div className={cn(
        'flex flex-col gap-3',
        fullscreen
          // Escapes the app shell so the console gets the whole window.
          ? 'surface-fullscreen fixed inset-0 h-screen bg-[rgb(var(--canvas))] p-3'
          // 1366x768 has ~660px of usable height, so the floor must stay under it.
          : 'h-[calc(100vh-7rem)] min-h-[420px]'
      )}>
        <header className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))]"><TerminalSquare size={20} /></span>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight">Terminal</h1>
              <p className="text-[11px] text-[rgb(var(--muted))]">SSH and Telnet console for branch switches</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="flex items-center gap-1 rounded-lg border bg-[rgb(var(--surface))] px-2 py-1">
              <Type size={12} className="text-[rgb(var(--muted))]" />
              <select
                aria-label="Terminal font"
                value={fontFamily}
                onChange={(event) => setFontFamily(event.target.value)}
                className="max-w-[9rem] bg-transparent text-[11px] font-bold outline-none"
              >
                {MONO_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
              </select>
              <span className="h-4 w-px bg-[rgb(var(--border))]" />
              <select
                aria-label="Font size"
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value))}
                className="bg-transparent text-[11px] font-bold outline-none"
              >
                {FONT_SIZES.map((value) => <option key={value} value={value}>{value}px</option>)}
              </select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFullscreen((value) => !value)}
              aria-label={fullscreen ? 'Exit terminal fullscreen' : 'Enter terminal fullscreen'}
              title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen terminal (F11)'}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </Button>
            <Button variant="ghost" size="sm" onClick={load} title="Reload switches"><RefreshCw size={14} /></Button>
          </div>
        </header>

        {/* Branch strip */}
        <div className={cn('flex items-center gap-2 overflow-x-auto rounded-2xl border bg-[rgb(var(--surface))] p-2', fullscreen && 'hidden')}>
          <Building2 size={14} className="ml-1 shrink-0 text-[rgb(var(--muted))]" />
          {loading && !branches.length && [0, 1, 2].map((key) => <Skeleton key={key} className="h-8 w-32 shrink-0" />)}
          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => setActiveBranchId(branch.id)}
              className={cn(
                'relative shrink-0 rounded-xl px-3 py-1.5 text-[12px] font-bold transition-colors',
                branch.id === activeBranchId ? 'text-[rgb(var(--primary))]' : 'text-[rgb(var(--muted))] hover:bg-[rgb(var(--border)/.45)] hover:text-[rgb(var(--text))]'
              )}
            >
              {branch.id === activeBranchId && <motion.span layoutId="terminal-branch-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-xl bg-[rgb(var(--primary)/.13)]" />}
              <span className="relative flex items-center gap-1.5">
                {branch.name}
                <span className="rounded-md bg-[rgb(var(--border)/.7)] px-1.5 text-[9px]">{branch.switches.length}</span>
              </span>
            </button>
          ))}
          {!loading && !branches.length && <span className="px-2 text-[11px] text-[rgb(var(--muted))]">No branch has a switch yet.</span>}
        </div>

        <div className={cn(
          'grid min-h-0 flex-1 grid-cols-1 gap-3',
          !fullscreen && 'xl:grid-cols-[minmax(0,1fr)_260px]',
          fullscreen && showSnippets && 'md:grid-cols-[minmax(0,1fr)_280px]'
        )}>
          <div className="flex min-h-0 flex-col gap-3">
            {/* Switch chips for the selected branch */}
            <div className={cn('flex flex-wrap gap-2', fullscreen && 'hidden')}>
              <AnimatePresence initial={false} mode="popLayout">
                {(activeBranch?.switches || []).map((device) => {
                  const isActive = session?.deviceId === device.id && live
                  return (
                    <motion.button
                      key={device.id}
                      layout
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.94 }}
                      type="button"
                      onClick={() => connect(device)}
                      disabled={busyDeviceId === device.id}
                      className={cn(
                        'group flex items-center gap-2 rounded-xl border bg-[rgb(var(--surface))] px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:border-[rgb(var(--primary)/.6)] hover:shadow-md',
                        isActive && 'border-[rgb(var(--primary))] bg-[rgb(var(--primary)/.1)]'
                      )}
                    >
                      {busyDeviceId === device.id
                        ? <Loader2 size={14} className="animate-spin text-[rgb(var(--primary))]" />
                        : <Cable size={14} className={cn('text-[rgb(var(--muted))]', isActive && 'text-[rgb(var(--primary))]')} />}
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-bold leading-tight">{device.name}</span>
                        <span className="block truncate font-mono text-[10px] text-[rgb(var(--muted))]">{device.ip}</span>
                      </span>
                      <span className={cn(
                        'ml-1 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide',
                        device.transport === 'telnet' ? 'bg-nord-13/20 text-nord-13' : 'bg-nord-14/20 text-nord-14'
                      )}>{device.transport}</span>
                    </motion.button>
                  )
                })}
              </AnimatePresence>
            </div>

            {/* Session bar + screen */}
            {session ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-[rgb(var(--surface))] px-3 py-1.5 text-[11px]">
                  <Circle size={8} fill={statusStyle.color} color={statusStyle.color} className={status.state === 'connecting' ? 'animate-pulse' : undefined} />
                  <span className="font-extrabold">{session.name}</span>
                  <span className="font-mono text-[rgb(var(--muted))]">{session.username ? `${session.username}@` : ''}{session.host}:{session.port}</span>
                  <span className="rounded-md bg-[rgb(var(--border)/.7)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase">{session.transport}</span>
                  <span className="text-[rgb(var(--muted))]">{statusStyle.label}{status.message ? ` — ${status.message}` : ''}</span>
                  <span className="ml-auto font-mono text-[10px] text-[rgb(var(--muted))]">{grid.cols}×{grid.rows}</span>
                  <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(`${session.host}:${session.port}`); toast.success('Address copied') }} title="Copy address"><Copy size={13} /></Button>
                  {live
                    ? <Button variant="danger" size="sm" onClick={disconnect}><Power size={13} /> Disconnect</Button>
                    : <Button variant="ghost" size="sm" onClick={() => setSession(null)} title="Close pane"><X size={13} /></Button>}
                </div>
                <div className="min-h-0 flex-1">
                  <TerminalScreen
                    session={{ ...session, state: status.state }}
                    api={terminalApi}
                    fontSize={fontSize}
                    fontFamily={monoStack(fontFamily)}
                    onSizeChange={setGrid}
                  />
                </div>
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 place-items-center rounded-2xl border border-dashed bg-[rgb(var(--surface)/.5)]">
                <EmptyState
                  icon={<TerminalSquare size={26} />}
                  title="No session open"
                  description={branches.length ? 'Pick a branch above, then choose a switch to open its console.' : 'Add a switch to a branch to start using the terminal.'}
                />
              </div>
            )}
          </div>

          {(!fullscreen || showSnippets) && (
            <SnippetPanel snippets={snippets} onSave={saveSnippet} onDelete={deleteSnippet} onRun={runSnippet} disabled={status.state !== 'connected'} />
          )}

          {/* Fullscreen Snippets handle, docked to the right edge of the screen
              so the panel is revealed and hidden from the side it lives on. */}
          {fullscreen && (
            <button
              type="button"
              onClick={() => setShowSnippets((value) => !value)}
              aria-label={showSnippets ? 'Hide snippets' : 'Show snippets'}
              aria-pressed={showSnippets}
              title={showSnippets ? 'Hide snippets' : 'Show snippets'}
              className={cn(
                'group fixed right-0 top-1/2 z-[70] flex -translate-y-1/2 items-center gap-1.5 rounded-l-xl border border-r-0 bg-[rgb(var(--surface))] py-3 pl-2 pr-1.5 shadow-lg transition-all hover:bg-[rgb(var(--primary)/.1)]',
                showSnippets && 'text-[rgb(var(--primary))]'
              )}
            >
              {showSnippets ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              <span className="text-[10px] font-bold uppercase tracking-widest [writing-mode:vertical-rl]">Snippets</span>
            </button>
          )}
        </div>
      </div>
    </AppShell>
  )
}

export default function TerminalPage() {
  return (
    <Suspense fallback={<AppShell><Skeleton className="h-[60vh] w-full" /></AppShell>}>
      <TerminalWorkspaceInner />
    </Suspense>
  )
}
