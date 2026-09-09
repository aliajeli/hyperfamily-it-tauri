'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ArrowRight,
  Check,
  CircleX,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  User,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { getApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { Button, Input } from '@/components/ui'
import BrandMark from '@/components/layout/BrandMark'

const PLACEHOLDER_CREDIT = 'Developed By ...'
const DEVELOPER_NAME = 'Ali Ajeli Lahiji'
const FINAL_CREDIT = `Developed By ${DEVELOPER_NAME}`
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))

function DeveloperCredit({ onComplete, reduceMotion }) {
  // Always start empty so the server-rendered HTML and the first client
  // render match; reduced-motion short-circuits inside the effect instead.
  const [text, setText] = useState('')

  useEffect(() => {
    let active = true

    const typeText = async (value, speed, startAt = 1) => {
      for (let index = startAt; active && index <= value.length; index += 1) {
        setText(value.slice(0, index))
        await wait(speed)
      }
    }

    const playSequence = async () => {
      if (reduceMotion) {
        setText(FINAL_CREDIT)
        onComplete()
        return
      }

      await wait(1450)
      if (!active) return
      await typeText(PLACEHOLDER_CREDIT, 46)
      await wait(720)

      for (let index = 1; active && index <= 3; index += 1) {
        setText(PLACEHOLDER_CREDIT.slice(0, -index))
        await wait(125)
      }

      await typeText(FINAL_CREDIT, 48, PLACEHOLDER_CREDIT.length - 3 + 1)
      await wait(620)
      if (active) onComplete()
    }

    playSequence()
    return () => { active = false }
  }, [onComplete, reduceMotion])

  return (
    <motion.div
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: text ? 1 : 0, y: text ? 0 : 7 }}
      className="mt-3 flex h-6 items-center justify-center font-mono text-[12px] font-medium tracking-[0.04em] text-[rgb(var(--muted))]"
      aria-label={FINAL_CREDIT}
    >
      <span aria-hidden="true">
        <span className="text-[rgb(var(--primary))]">{'<'}</span>
        <span className="mx-1.5">{text}</span>
        <span className="text-[rgb(var(--primary))]">{'/>'}</span>
        <span className="login-code-caret ml-1 inline-block h-4 w-[2px] rounded-full bg-[rgb(var(--primary))] align-middle" />
      </span>
    </motion.div>
  )
}

function AuthenticationStatus({ phase }) {
  const success = phase === 'success' || phase === 'entering'
  const failed = phase === 'error'

  return (
    <motion.div
      key="authentication-status"
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ duration: 0.3 }}
      className="flex min-h-[264px] flex-col items-center justify-center text-center"
      role="status"
      aria-live="polite"
    >
      <div className="relative mb-6 flex h-24 w-24 items-center justify-center">
        <AnimatePresence mode="wait">
          {phase === 'checking' && (
            <motion.div key="checking" className="absolute inset-0">
              <motion.div
                className="absolute inset-0 rounded-full border border-[rgb(var(--primary)/.18)]"
                animate={{ scale: [0.82, 1.18], opacity: [0.8, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-2 rounded-full border-2 border-transparent border-r-[rgb(var(--secondary))] border-t-[rgb(var(--primary))]"
                animate={{ rotate: 360 }}
                transition={{ duration: 1.05, repeat: Infinity, ease: 'linear' }}
              />
              <motion.div
                className="absolute inset-5 flex items-center justify-center rounded-full bg-[rgb(var(--primary)/.1)] text-[rgb(var(--primary))]"
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              >
                <ShieldCheck size={30} strokeWidth={1.8} />
              </motion.div>
            </motion.div>
          )}

          {success && (
            <motion.div
              key="success"
              initial={{ scale: 0.45, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 240, damping: 17 }}
              className="absolute inset-2 flex items-center justify-center rounded-full bg-nord-14 text-white shadow-[0_0_32px_rgba(163,190,140,.42)]"
            >
              <motion.div initial={{ rotate: -35, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: 0.18, type: 'spring' }}>
                <Check size={42} strokeWidth={2.8} />
              </motion.div>
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-nord-14"
                animate={{ scale: [1, 1.42], opacity: [0.7, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, ease: 'easeOut' }}
              />
            </motion.div>
          )}

          {failed && (
            <motion.div
              key="failed"
              initial={{ scale: 0.5, opacity: 0, rotate: -15 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              className="absolute inset-2 flex items-center justify-center rounded-full bg-nord-11/15 text-nord-11"
            >
              <CircleX size={42} strokeWidth={2.2} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={phase}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          className="min-h-[68px]"
        >
          <h2 className="text-lg font-bold tracking-tight">
            {phase === 'checking' && 'Verifying credentials'}
            {phase === 'success' && 'Access granted'}
            {phase === 'entering' && 'Opening your workspace'}
            {phase === 'error' && 'Access denied'}
          </h2>
          <p className="mt-1.5 text-xs text-[rgb(var(--muted))]">
            {phase === 'checking' && 'Checking your encrypted local account…'}
            {phase === 'success' && 'Identity confirmed. Welcome back.'}
            {phase === 'entering' && 'Preparing the operations dashboard…'}
            {phase === 'error' && 'The username or password is incorrect.'}
          </p>
        </motion.div>
      </AnimatePresence>

      {phase === 'checking' && (
        <div className="mt-2 flex w-36 gap-1.5" aria-hidden="true">
          {[0, 1, 2, 3].map((item) => (
            <motion.span
              key={item}
              className="h-1 flex-1 rounded-full bg-[rgb(var(--primary))]"
              animate={{ opacity: [0.18, 1, 0.18], scaleX: [0.72, 1, 0.72] }}
              transition={{ duration: 1, repeat: Infinity, delay: item * 0.14 }}
            />
          ))}
        </div>
      )}
    </motion.div>
  )
}

/**
 * Credential recovery (v2.0.21).
 *
 * Opened from the small corner link: the user enters their recovery PIN and —
 * only when it matches — sees the stored username and password. Five wrong
 * attempts lock the dialog for five minutes, exactly like the standalone
 * recovery tool.
 */
function RecoveryDialog({ open, onOpenChange }) {
  const [status, setStatus] = useState(null) // { pinSet }
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [locked, setLocked] = useState(false)
  const [remainingAttempts, setRemainingAttempts] = useState(null)
  const [retryAfter, setRetryAfter] = useState(null) // seconds
  const [result, setResult] = useState(null) // { username, password }
  const [copied, setCopied] = useState(null)

  useEffect(() => {
    if (!open) return
    setPin(''); setMessage(''); setLocked(false); setRemainingAttempts(null)
    setRetryAfter(null); setResult(null); setCopied(null)
    getApi().auth.recoverStatus()
      .then(setStatus)
      .catch((error) => setMessage(error.message))
  }, [open])

  // Countdown while locked out.
  useEffect(() => {
    if (!retryAfter) return undefined
    const timer = setInterval(() => setRetryAfter((value) => {
      const next = (value || 0) - 1
      if (next <= 0) { setLocked(false); return null }
      return next
    }), 1000)
    return () => clearInterval(timer)
  }, [retryAfter])

  const submit = async (event) => {
    event.preventDefault()
    if (busy || locked) return
    setBusy(true)
    try {
      const outcome = await getApi().auth.recover(pin)
      if (outcome.ok) {
        setResult({ username: outcome.username, password: outcome.password })
        setMessage('')
      } else if (outcome.locked) {
        setLocked(true)
        setRemainingAttempts(null)
        setRetryAfter(Math.ceil((outcome.retryAfterMs || 0) / 1000))
        setMessage('Too many wrong attempts — recovery is locked for 5 minutes.')
      } else {
        setRemainingAttempts(outcome.remainingAttempts)
        setMessage(`Wrong PIN. ${outcome.remainingAttempts} attempt${outcome.remainingAttempts === 1 ? '' : 's'} left.`)
      }
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1400)
    } catch { /* clipboard may be unavailable */ }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
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
                className="dialog-content glass fixed left-1/2 top-1/2 z-[80] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-[rgb(var(--surface))] p-4 shadow-2xl outline-none"
              >
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-[rgb(var(--primary)/.14)] p-1.5 text-[rgb(var(--primary))]"><KeyRound size={15} /></div>
                  <div>
                    <DialogPrimitive.Title className="text-sm font-extrabold">Recover credentials</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="text-[10px] text-[rgb(var(--muted))]">
                      Enter the recovery PIN to see the stored login.
                    </DialogPrimitive.Description>
                  </div>
                  <DialogPrimitive.Close asChild>
                    <button type="button" aria-label="Close credential recovery" className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-[rgb(var(--muted))] transition hover:bg-[rgb(var(--border)/.5)] hover:text-[rgb(var(--text))]">
                      <X size={15} />
                    </button>
                  </DialogPrimitive.Close>
                </div>

                {result ? (
                  <div className="mt-3 space-y-1.5">
                    {[['Username', result.username, 'user'], ['Password', result.password || 'not recorded', 'pass']].map(([label, value, key]) => (
                      <div key={key} className="flex items-center gap-2 rounded-xl border bg-[rgb(var(--canvas)/.6)] p-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[9px] font-extrabold uppercase tracking-wider text-[rgb(var(--muted))]">{label}</p>
                          <p className="truncate font-mono text-[12px]" title={value}>{value}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => copy(value, key)}
                          className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-[rgb(var(--primary)/.12)] px-2 text-[10px] font-extrabold text-[rgb(var(--primary))] transition hover:bg-[rgb(var(--primary)/.22)]"
                        >
                          {copied === key ? <Check size={11} /> : <Copy size={11} />}
                          {copied === key ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    ))}
                    <p className="text-[9.5px] leading-snug text-[rgb(var(--muted))]">
                      Keep these safe — anyone with them can open the application.
                    </p>
                  </div>
                ) : status && !status.pinSet ? (
                  <p className="mt-3 rounded-xl border bg-nord-13/10 p-2.5 text-[11px] leading-relaxed text-[#8b6e1c]">
                    No recovery PIN has been set yet. Sign in normally and set one in <b>Settings → General</b> to enable recovery.
                  </p>
                ) : (
                  <form onSubmit={submit} className="mt-3 space-y-2">
                    <Input
                      autoFocus
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={8}
                      disabled={locked || busy}
                      placeholder="Recovery PIN"
                      aria-label="Recovery PIN"
                      value={pin}
                      onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                    />
                    {message && <p className={`text-[10.5px] leading-snug ${locked ? 'text-nord-11' : 'text-[rgb(var(--muted))]'}`}>{message}{locked && retryAfter ? ` Try again in ${Math.floor(retryAfter / 60)}:${String(retryAfter % 60).padStart(2, '0')}.` : ''}</p>}
                    {remainingAttempts !== null && !locked && <p className="text-[9.5px] text-[rgb(var(--muted))]">{remainingAttempts} attempt{remainingAttempts === 1 ? '' : 's'} remaining before a 5-minute lock.</p>}
                    <Button disabled={locked || busy || pin.length < 4} className="w-full">
                      {busy ? 'Checking…' : 'Reveal credentials'}
                    </Button>
                  </form>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const { user, hydrated, login } = useAuthStore()
  // Defaults only apply on a brand-new machine; the "remember me" copy
  // (v2.0.22) replaces them as soon as it is read back.
  const [form, setForm] = useState({ username: 'Admin', password: 'Admin', remember: true })
  const [showPassword, setShowPassword] = useState(false)
  // Starts false on the server AND the client so hydration always matches;
  // reduced-motion short-circuits the intro right after mount.
  const [introComplete, setIntroComplete] = useState(false)
  const [authPhase, setAuthPhase] = useState('idle')
  const [recoverOpen, setRecoverOpen] = useState(false)

  useEffect(() => { if (hydrated && user) router.replace('/dashboard') }, [hydrated, user, router])
  useEffect(() => { if (reduceMotion) setIntroComplete(true) }, [reduceMotion])

  // Prefill the last successfully signed-in credentials when they were saved.
  useEffect(() => {
    getApi().auth.rememberedCredentials?.().then((saved) => {
      if (!saved?.username) return
      setForm({ username: saved.username, password: saved.password, remember: true })
    }).catch(() => { /* prefill is best-effort */ })
  }, [])

  const finishIntro = useCallback(() => setIntroComplete(true), [])

  const submit = async (event) => {
    event.preventDefault()
    if (authPhase !== 'idle') return
    if (!form.username.trim() || form.password.length < 4) {
      toast.error('Enter a username and a password of at least 4 characters')
      return
    }

    setAuthPhase('checking')
    const authentication = getApi().auth.login(form)
      .then((authenticatedUser) => ({ authenticatedUser }))
      .catch((error) => ({ error }))

    await wait(reduceMotion ? 200 : 1450)
    const result = await authentication

    if (result.error) {
      setAuthPhase('error')
      toast.error(result.error.message || 'Login failed')
      await wait(reduceMotion ? 250 : 1050)
      setAuthPhase('idle')
      return
    }

    // Only a successful sign-in is remembered, and only while the checkbox
    // is ticked; unchecking it clears any previously saved credentials.
    getApi().auth.rememberCredentials?.(
      form.remember ? { username: form.username.trim(), password: form.password } : {}
    ).catch(() => { /* remember-me is best-effort */ })

    setAuthPhase('success')
    await wait(reduceMotion ? 180 : 850)
    setAuthPhase('entering')
    await wait(reduceMotion ? 180 : 520)

    login(result.authenticatedUser)
    window.dispatchEvent(new CustomEvent('hyperfamily:data-changed'))
    toast.success(`Welcome back, ${result.authenticatedUser.username}`)
    router.replace('/dashboard')
  }

  const isAuthenticating = authPhase !== 'idle'

  return (
    <main className="relative flex min-h-[100dvh] flex-col overflow-x-hidden overflow-y-auto px-4 py-4 sm:py-6">
      <div className="pointer-events-none fixed -left-32 -top-36 h-[30rem] w-[30rem] animate-float rounded-full bg-nord-8/25 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-44 -right-28 h-[34rem] w-[34rem] animate-float rounded-full bg-nord-15/20 blur-3xl [animation-delay:-9s]" />
      <motion.div
        className="pointer-events-none fixed left-[12%] top-[18%] h-2 w-2 rounded-full bg-[rgb(var(--primary)/.36)]"
        animate={{ y: [0, -20, 0], opacity: [0.25, 0.8, 0.25] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none fixed bottom-[22%] right-[15%] h-1.5 w-1.5 rounded-full bg-[rgb(var(--secondary)/.48)]"
        animate={{ y: [0, 18, 0], opacity: [0.2, 0.75, 0.2] }}
        transition={{ duration: 3.8, repeat: Infinity, delay: 0.7, ease: 'easeInOut' }}
      />

      <motion.div
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{
          opacity: authPhase === 'entering' ? 0 : 1,
          y: authPhase === 'entering' ? -18 : 0,
          scale: authPhase === 'entering' ? 0.96 : 1,
          x: authPhase === 'error' ? [0, -6, 6, -4, 4, 0] : 0
        }}
        transition={{ duration: 0.45, layout: { duration: 0.55, type: 'spring', bounce: 0.16 } }}
        className="glass login-card relative z-10 m-auto w-full max-w-[460px] overflow-hidden rounded-[30px] p-6 sm:p-8"
      >
        <div className="login-card-highlight pointer-events-none absolute inset-x-12 top-0 h-px" />

        <motion.section
          layout
          animate={{ minHeight: introComplete ? 0 : 340 }}
          transition={{ minHeight: { duration: 0.62, ease: [0.22, 1, 0.36, 1] }, layout: { duration: 0.55 } }}
          className="relative flex flex-col items-center justify-center text-center"
        >
          <motion.div
            layout
            initial={{ opacity: 0, scale: 0.78, filter: 'blur(8px)' }}
            animate={{
              opacity: 1,
              scale: 1,
              filter: 'blur(0px)',
              width: introComplete ? 60 : 82,
              height: introComplete ? 60 : 82
            }}
            transition={{ opacity: { duration: 0.75 }, scale: { duration: 0.8, ease: 'easeOut' }, width: { duration: 0.55 }, height: { duration: 0.55 } }}
            className="relative"
          >
            <motion.span
              className="absolute -inset-2 rounded-[24px] border border-[rgb(var(--primary)/.2)]"
              animate={{ scale: [0.94, 1.09, 0.94], opacity: [0.3, 0.72, 0.3] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.span
              className="absolute -inset-4 rounded-[28px] border border-[rgb(var(--secondary)/.12)]"
              animate={{ rotate: 360 }}
              transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
            >
              <span className="absolute -right-1 top-1/2 h-2 w-2 rounded-full bg-[rgb(var(--secondary))] shadow-[0_0_10px_rgb(var(--secondary))]" />
            </motion.span>
            <BrandMark className="relative h-full w-full drop-shadow-[0_10px_20px_rgba(46,52,64,.16)]" />
          </motion.div>

          <motion.h1
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, fontSize: introComplete ? 24 : 29 }}
            transition={{ opacity: { delay: 0.72, duration: 0.68 }, y: { delay: 0.72, duration: 0.68 }, fontSize: { duration: 0.55 } }}
            className="mt-5 font-extrabold tracking-tight"
          >
            Welcome to <span className="gradient-text">Hyper Family</span>
          </motion.h1>

          <DeveloperCredit onComplete={finishIntro} reduceMotion={reduceMotion} />

          <AnimatePresence>
            {introComplete && (
              <motion.p
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="mt-2 text-xs text-[rgb(var(--muted))]"
              >
                Sign in to the branch operations control center
              </motion.p>
            )}
          </AnimatePresence>
        </motion.section>

        <AnimatePresence mode="wait">
          {introComplete && authPhase === 'idle' ? (
            <motion.form
              key="login-form"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12, filter: 'blur(5px)' }}
              transition={{ duration: 0.42, delay: 0.12 }}
              onSubmit={submit}
              className="mt-6 space-y-4"
            >
              <motion.label
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="group relative block"
              >
                <span className="field-label transition-colors group-focus-within:text-[rgb(var(--primary))]">Username</span>
                <User className="absolute bottom-3.5 left-3.5 text-[rgb(var(--muted))] transition-colors group-focus-within:text-[rgb(var(--primary))]" size={17} />
                <Input
                  autoFocus
                  autoComplete="username"
                  disabled={isAuthenticating}
                  className="pl-10 transition-all duration-300 focus:-translate-y-0.5 focus:shadow-[0_8px_24px_rgb(var(--primary)/.12)]"
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                />
              </motion.label>

              <motion.label
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="group relative block"
              >
                <span className="field-label transition-colors group-focus-within:text-[rgb(var(--primary))]">Password</span>
                <LockKeyhole className="absolute bottom-3.5 left-3.5 text-[rgb(var(--muted))] transition-colors group-focus-within:text-[rgb(var(--primary))]" size={17} />
                <Input
                  autoComplete="current-password"
                  disabled={isAuthenticating}
                  type={showPassword ? 'text' : 'password'}
                  className="px-10 transition-all duration-300 focus:-translate-y-0.5 focus:shadow-[0_8px_24px_rgb(var(--primary)/.12)]"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute bottom-2.5 right-2.5 rounded-lg p-2 text-[rgb(var(--muted))] transition hover:scale-110 hover:bg-[rgb(var(--border)/.5)] hover:text-[rgb(var(--text))]"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </motion.label>

              <motion.label
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.48 }}
                className="flex cursor-pointer items-center gap-2 text-xs text-[rgb(var(--muted))]"
              >
                <input
                  type="checkbox"
                  checked={form.remember}
                  onChange={(event) => setForm({ ...form, remember: event.target.checked })}
                  className="accent-[rgb(var(--primary))]"
                />
                Remember this account on this device
              </motion.label>

              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.52 }}>
                <Button disabled={isAuthenticating} className="login-button group mt-1 h-12 w-full overflow-hidden">
                  <span className="relative z-10">Sign in securely</span>
                  <ArrowRight className="login-button-icon relative z-10 transition-transform duration-300 group-hover:translate-x-1" size={17} />
                </Button>
              </motion.div>
            </motion.form>
          ) : introComplete ? (
            <AuthenticationStatus phase={authPhase} />
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {introComplete && authPhase === 'idle' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.65 }}
              className="mt-6 flex items-center justify-center gap-2 border-t pt-5 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--muted))]"
            >
              <ShieldCheck size={14} className="text-nord-14" />
              Local encrypted workspace • Windows 10/11
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <p className="relative z-10 mt-auto pt-3 text-center text-[10px] uppercase tracking-[.2em] text-[rgb(var(--muted))]">
        HyperFamily Stores • IT Operations
      </p>

      {/* Corner recovery link (v2.0.21): a quiet way back in when the
          administrator forgets the login. PIN-gated. */}
      <button
        type="button"
        onClick={() => setRecoverOpen(true)}
        aria-label="Recover credentials"
        className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full border bg-[rgb(var(--surface)/.72)] px-3 py-1.5 text-[10px] font-bold text-[rgb(var(--muted))] shadow-sm backdrop-blur transition hover:border-[rgb(var(--primary)/.5)] hover:text-[rgb(var(--primary))]"
      >
        <KeyRound size={12} />
        Recover credentials
      </button>

      <RecoveryDialog open={recoverOpen} onOpenChange={setRecoverOpen} />
    </main>
  )
}
