'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { RefreshCw, Download, Rocket, Github, CircleDot, HardDrive, Code2, ExternalLink, CheckCircle2, Mail, Pause, Play, Square, ScrollText, X } from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import AppShell from '@/components/layout/AppShell'
import BrandMark from '@/components/layout/BrandMark'
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui'
import { getApi } from '@/lib/api'
import { APP_NAME, APP_VERSION } from '@/lib/constants'
import stack from '@/lib/technology-stack.json'
import packageInfo from '@/package.json'

// Credit technologies used by the shipped application and its Windows build.
// Versioned labels follow the dependency manifest rather than handwritten majors.
const technologies = stack.map((entry) => {
  const version = packageInfo.dependencies[entry.package] || packageInfo.devDependencies[entry.package]
  const major = entry.showMajor && version?.match(/\d+/)?.[0]
  return { ...entry, name: major ? `${entry.name} ${major}` : entry.name }
})

/** Developer contact. mailto: hands the address to the default mail client. */
const DEVELOPER_EMAIL = 'Lahiji.ali@hyperfamili.com'

const REPO = 'https://github.com/aliajeli/hyperfamily-it-app'

/** 183807865 -> "175.3 MB". Sizes are shown in the units users recognise. */
function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let index = 0
  let size = value
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1 }
  return `${size.toFixed(index === 0 ? 0 : size >= 100 ? 0 : 1)} ${units[index]}`
}

/** 95 -> "1m 35s", used for the estimated time remaining. */
function formatDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return null
  if (value < 60) return `${Math.round(value)}s`
  const minutes = Math.floor(value / 60)
  const rest = Math.round(value % 60)
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export default function AboutPage() {
  const [info, setInfo] = useState({ version: APP_VERSION, platform: 'Windows 10/11', dataPath: '—' })
  const [update, setUpdate] = useState(null)
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [paused, setPaused] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  // Live transfer figures: how much has arrived, how much is left, how fast.
  const [transfer, setTransfer] = useState({ transferred: 0, total: 0, remaining: 0, bytesPerSecond: 0, etaSeconds: null })
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const api = getApi()
    if (!api) return undefined
    api.app.info().then(setInfo).catch(() => {})
    // A previous visit may already have finished the download; restore the
    // button straight into its Install state instead of offering Download again.
    api.update.state?.().then((state) => {
      if (!state) return
      setDownloading(Boolean(state.downloading))
      setPaused(Boolean(state.paused))
      setDownloaded(Boolean(state.downloaded))
      setProgress(Number(state.percent) || 0)
      setTransfer({
        transferred: Number(state.transferred) || 0,
        total: Number(state.total) || 0,
        remaining: Number(state.remaining) || 0,
        bytesPerSecond: Number(state.bytesPerSecond) || 0,
        etaSeconds: state.etaSeconds ?? null
      })
    }).catch(() => {})

    const unsubscribe = api.update.subscribe((event) => {
      if (event.type === 'progress') {
        setDownloading(true)
        setPaused(false)
        setProgress(Math.round(event.percent || 0))
        setTransfer({
          transferred: Number(event.transferred) || 0,
          total: Number(event.total) || 0,
          remaining: Number(event.remaining) || 0,
          bytesPerSecond: Number(event.bytesPerSecond) || 0,
          etaSeconds: event.etaSeconds ?? null
        })
      }
      if (event.type === 'downloaded') {
        setDownloading(false)
        setDownloaded(true)
        setProgress(100)
        setTransfer((current) => ({ ...current, transferred: event.total || current.total, remaining: 0, bytesPerSecond: 0, etaSeconds: null }))
        toast.success('Update downloaded — press Install to restart on the new version')
      }
      if (event.type === 'error') {
        setDownloading(false)
        setPaused(false)
        setProgress(0)
        setTransfer({ transferred: 0, total: 0, remaining: 0, bytesPerSecond: 0, etaSeconds: null })
        toast.error(event.message)
      }
      if (event.type === 'paused') {
        setDownloading(false)
        setPaused(true)
        toast.info('Download paused', { description: 'Resume it whenever you are ready.' })
      }
      if (event.type === 'resumed') {
        setPaused(false)
        setDownloading(true)
        toast.info('Download resumed')
      }
      if (event.type === 'stopped') {
        setDownloading(false)
        setPaused(false)
        setProgress(0)
        setTransfer({ transferred: 0, total: 0, remaining: 0, bytesPerSecond: 0, etaSeconds: null })
        toast.info('Download cancelled')
      }
    })
    return () => unsubscribe?.()
  }, [])

  const check = async () => {
    setChecking(true)
    try {
      const result = await getApi().update.check()
      setUpdate(result)
      toast[result.hasUpdate ? 'success' : 'info'](result.hasUpdate ? `Version ${result.latestVersion} is available` : 'You are running the latest version')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setChecking(false)
    }
  }

  const external = (url) => getApi().app.openExternal(url).catch((e) => toast.error(e.message))

  /**
   * Opens the default mail client (Outlook on the target Windows machines) with
   * a message already addressed to the developer. Subject and body carry the
   * app version and platform so a report arrives with its context attached.
   */
  const emailDeveloper = () => {
    const subject = `HyperFamily Branch Monitor ${info.version} — feedback`
    const body = [
      'Hello Ali,',
      '',
      '',
      '---',
      `Application: HyperFamily Branch Monitor ${info.version}`,
      `Platform: ${info.platform || 'Windows'}`
    ].join('\r\n')
    external(`mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
  }

  /**
   * Downloads the installer in the background. The service already falls back
   * to the plain GitHub asset internally, so only a total failure opens the
   * release page in the browser.
   */
  const download = async () => {
    setDownloading(true)
    setProgress(1)
    try {
      const state = await getApi().update.download()
      if (state?.downloaded) { setDownloaded(true); setProgress(100) }
    } catch (error) {
      setDownloading(false)
      setProgress(0)
      const target = update?.downloadUrl || `${REPO}/releases/latest`
      toast.message('Opening the GitHub release instead', { description: error.message })
      external(target)
    } finally {
      setDownloading(false)
    }
  }

  /** Pauses the download; the service keeps the progress so it can resume. */
  const pause = async () => {
    try {
      await getApi().update.pause()
    } catch (error) {
      toast.error(error.message)
    }
  }

  /** Continues a paused download from where it stopped. */
  const resume = async () => {
    try {
      setPaused(false)
      await getApi().update.resume()
    } catch (error) {
      toast.error(error.message)
    }
  }

  /** Cancels the download entirely and clears the progress. */
  const stop = async () => {
    try {
      await getApi().update.stop()
    } catch (error) {
      toast.error(error.message)
    }
  }

  /** Applies the downloaded update and relaunches on the new version. */
  const install = async () => {
    setInstalling(true)
    try {
      toast.message('Installing the update', { description: 'The application will close and reopen on the new version.' })
      await getApi().update.install()
    } catch (error) {
      setInstalling(false)
      toast.error(error.message)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] space-y-2">
        <div>
          <h1 className="page-title">About HyperFamily Monitor</h1>
          <p className="page-subtitle">Product information, secure updates, technology credits, and support.</p>
        </div>

        <div className="grid items-start gap-2 lg:grid-cols-[1.05fr_.95fr]">
          <Card aria-label="Product overview" className="relative overflow-hidden border-[rgb(var(--primary)/.25)]">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[rgb(var(--primary)/.10)] via-transparent to-[rgb(var(--primary)/.04)]" />
            <CardContent className="relative p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-[rgb(var(--primary)/.18)] bg-[rgb(var(--surface)/.75)] shadow-sm">
                  <BrandMark className="h-12 w-12" symbol />
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-[.18em] text-[rgb(var(--primary))]">HyperFamily Stores · IT Operations</p>
                  <h2 className="text-lg font-bold leading-tight tracking-tight">{APP_NAME}</h2>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[rgb(var(--muted))]">Branch connectivity, inventory and remote support — together in one Windows workspace.</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[rgb(var(--primary)/.15)] pt-3">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--muted))]">{info.version.includes('-') ? 'Preview release' : 'Stable release'}</p>
                  <p className="mt-0.5 font-mono text-sm font-bold text-[rgb(var(--primary))]">v{info.version}</p>
                </div>
                <div className="space-y-1 text-[10px] text-[rgb(var(--muted))]">
                  <span className="flex items-center gap-1.5"><HardDrive size={12} />{info.platform}</span>
                  <span className="flex items-center gap-1.5"><Code2 size={12} />Ali Ajeli Lahiji</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-2.5 pb-1">
              <CardTitle className="flex items-center gap-2 text-[13px]"><Rocket size={15} />Application updates</CardTitle>
              <CardDescription className="mt-0 text-[10.5px] leading-snug">Updates arrive as a small differential download and install themselves.</CardDescription>
            </CardHeader>
            <CardContent className="p-2.5 pt-1">
              <div className="rounded-lg border bg-[rgb(var(--surface)/.42)] p-2">
                <div className="flex items-center justify-between">
                  <span>
                    <small className="block text-[9.5px] uppercase tracking-wider text-[rgb(var(--muted))]">Installed version</small>
                    <b className="text-[13px]">v{info.version}</b>
                  </span>
                  {update && (
                    <span className="text-right">
                      <small className="block text-[9.5px] uppercase tracking-wider text-[rgb(var(--muted))]">Latest release</small>
                      <b className={`text-[13px] ${update.hasUpdate ? 'text-[rgb(var(--primary))]' : ''}`}>v{update.latestVersion}</b>
                    </span>
                  )}
                </div>
                {update?.hasUpdate && update.downloadSize > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[rgb(var(--muted))]" aria-label="Update download size">
                    <HardDrive size={12} />
                    Download size <b className="text-[rgb(var(--text))]">{formatBytes(update.downloadSize)}</b>
                    {update.downloadName ? <span className="truncate opacity-70">· {update.downloadName}</span> : null}
                  </p>
                )}
                {update && !update.hasUpdate && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] status-online-text"><CheckCircle2 size={12} />You are running the latest version.</p>
                )}
                {(downloading || progress > 0 || downloaded) && (
                  <div className="mt-3" aria-label="Update download progress">
                    <div className="mb-1 flex justify-between text-[9.5px]">
                      <span>{downloaded ? 'Update ready to install' : paused ? 'Download paused' : 'Downloading update'}</span>
                      <b>{progress}%</b>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[rgb(var(--border))]">
                      <motion.div animate={{ width: `${progress}%` }} className="h-full bg-[rgb(var(--primary))]" />
                    </div>
                    {transfer.total > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px] text-[rgb(var(--muted))]">
                        <span>
                          <b className="text-[rgb(var(--text))]">{formatBytes(transfer.transferred)}</b> of {formatBytes(transfer.total)}
                          {!downloaded && transfer.remaining > 0 ? <> · {formatBytes(transfer.remaining)} left</> : null}
                        </span>
                        {!downloaded && (transfer.bytesPerSecond > 0 || transfer.etaSeconds) && (
                          <span>
                            {transfer.bytesPerSecond > 0 ? <b className="text-[rgb(var(--text))]">{formatBytes(transfer.bytesPerSecond)}/s</b> : null}
                            {formatDuration(transfer.etaSeconds) ? <> · {formatDuration(transfer.etaSeconds)} remaining</> : null}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" onClick={check} disabled={checking} variant="secondary">
                  <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />{checking ? 'Checking…' : 'Check for updates'}
                </Button>
                {update?.hasUpdate && !downloaded && !downloading && !paused && (
                  <Button size="sm" onClick={download}>
                    <Download size={14} />Download v{update.latestVersion}{update.downloadSize > 0 ? ` (${formatBytes(update.downloadSize)})` : ''}
                  </Button>
                )}
                {downloading && !paused && (
                  <>
                    <Button size="sm" variant="secondary" onClick={pause}>
                      <Pause size={14} />Pause
                    </Button>
                    <Button size="sm" variant="ghost" onClick={stop}>
                      <Square size={14} />Stop
                    </Button>
                  </>
                )}
                {paused && (
                  <>
                    <Button size="sm" onClick={resume}>
                      <Play size={14} />Resume
                    </Button>
                    <Button size="sm" variant="ghost" onClick={stop}>
                      <Square size={14} />Stop
                    </Button>
                  </>
                )}
                {downloaded && (
                  <Button size="sm" variant="success" onClick={install} disabled={installing}>
                    <Rocket size={14} />{installing ? 'Installing…' : 'Install and restart'}
                  </Button>
                )}
                {update?.hasUpdate && update.releaseNotes && (
                  <Button size="sm" variant="ghost" onClick={() => setChangelogOpen(true)}>
                    <ScrollText size={14} />View changelog
                  </Button>
                )}
                {update?.hasUpdate && (
                  <Button size="sm" variant="ghost" onClick={() => external(update.downloadUrl || `${REPO}/releases/latest`)}>
                    <Github size={14} />Get it from GitHub
                  </Button>
                )}
              </div>

              {update?.hasUpdate && update.releaseNotes && (
                <p className="mt-2 line-clamp-2 whitespace-pre-line text-[11px] leading-relaxed text-[rgb(var(--muted))]">{update.releaseNotes}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="p-2.5 pb-1">
            <CardTitle className="text-[13px]">Production technology stack</CardTitle>
            <CardDescription className="mt-0 text-[10.5px] leading-snug">Core runtime, interface, data protection, native Agent, and Windows build tools.</CardDescription>
          </CardHeader>
          <CardContent className="p-2.5 pt-1">
            <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
              {technologies.map(({ name, description, brand, brandDark }, index) => (
                <motion.div
                  key={name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * .02 }}
                  whileHover={{ y: -4, scale: 1.03 }}
                  whileTap={{ scale: .99 }}
                  style={{ '--brand': brand, '--brand-dark': brandDark }}
                  title={description}
                  className="tech-tile group relative min-w-0 overflow-hidden rounded-lg border bg-[rgb(var(--surface)/.38)] px-2 py-1.5"
                >
                  <span aria-hidden className="tech-tile-wash" />
                  <b className="tech-tile-name relative block text-[10.5px] leading-snug">{name}</b>
                  <p className="relative mt-0.5 text-[9px] leading-snug text-[rgb(var(--muted))]">{description}</p>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-2 lg:grid-cols-2">
        <Card className="p-2.5">
          <div className="flex h-full flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xs font-bold">Need help with branch infrastructure?</h3>
              <p className="text-[10px] leading-snug text-[rgb(var(--muted))]">Report a reproducible issue or browse the source repository.</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => external(`${REPO}/issues/new`)}><CircleDot size={14} />Report an issue</Button>
              <Button size="sm" onClick={() => external(REPO)}><Github size={14} />GitHub <ExternalLink size={12} /></Button>
            </div>
          </div>
        </Card>

        <Card className="p-2.5">
          <button
            type="button"
            onClick={emailDeveloper}
            className="contact-card group flex h-full w-full items-center gap-2.5 rounded-lg border bg-[rgb(var(--surface)/.38)] px-2.5 py-2 text-left transition"
            aria-label={`Send an email to ${DEVELOPER_EMAIL}`}
          >
            <span className="contact-card-icon grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))] transition">
              <Mail size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[11px]">Developer contact · Ali Ajeli Lahiji</b>
              <span className="block truncate font-mono text-[10.5px] text-[rgb(var(--primary))] underline-offset-2 group-hover:underline">{DEVELOPER_EMAIL}</span>
            </span>
            <ExternalLink size={14} className="shrink-0 text-[rgb(var(--muted))] transition group-hover:text-[rgb(var(--primary))]" />
          </button>
        </Card>
        </div>

        <footer className="pb-0.5 text-center text-[9px] uppercase tracking-widest text-[rgb(var(--muted))]">© 2026 HyperFamily Stores • MIT License • Built by Ali Ajeli Lahiji</footer>

        {/* Changelog of the available update, over a blurred page (v2.0.16). */}
        <DialogPrimitive.Root open={changelogOpen} onOpenChange={setChangelogOpen}>
          <AnimatePresence>
            {changelogOpen && update?.hasUpdate && (
              <DialogPrimitive.Portal forceMount>
                <DialogPrimitive.Overlay asChild forceMount>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[70] bg-nord-0/55 backdrop-blur-md"
                  />
                </DialogPrimitive.Overlay>
                <DialogPrimitive.Content asChild forceMount>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 8 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    className="dialog-content glass fixed left-1/2 top-1/2 z-[80] flex max-h-[80vh] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-[rgb(var(--surface))] p-3.5 shadow-2xl outline-none"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="rounded-lg bg-[rgb(var(--primary)/.14)] p-1.5 text-[rgb(var(--primary))]"><ScrollText size={15} /></div>
                      <div>
                        <DialogPrimitive.Title className="text-sm font-extrabold">What's new in v{update.latestVersion}</DialogPrimitive.Title>
                        <DialogPrimitive.Description className="text-[10px] text-[rgb(var(--muted))]">The release notes published with this update.</DialogPrimitive.Description>
                      </div>
                      <DialogPrimitive.Close asChild>
                        <button
                          type="button"
                          aria-label="Close changelog"
                          className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-[rgb(var(--muted))] transition hover:bg-[rgb(var(--border)/.5)] hover:text-[rgb(var(--text))]"
                        >
                          <X size={15} />
                        </button>
                      </DialogPrimitive.Close>
                    </div>
                    <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-[rgb(var(--canvas)/.6)] p-3 text-[11px] leading-relaxed">
                      {update.releaseNotes}
                    </div>
                    <div className="mt-2.5 flex items-center justify-end border-t pt-2.5">
                      <DialogPrimitive.Close asChild><Button size="sm">Close</Button></DialogPrimitive.Close>
                    </div>
                  </motion.div>
                </DialogPrimitive.Content>
              </DialogPrimitive.Portal>
            )}
          </AnimatePresence>
        </DialogPrimitive.Root>
      </div>
    </AppShell>
  )
}
