'use client'

import { useCallback, useEffect, useState } from 'react'
import { Shield, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getApi } from '@/lib/api'
import { useVpnStore } from '@/stores/vpn.store'
import { cn } from '@/lib/utils'

/**
 * A single button, no menu.
 *
 * There is only one VPN mode left (FortiClient), so a dropdown asking which
 * mode to use had nothing to offer: it added a click to every connect and a
 * popup that could cover the page. The button is now the control itself —
 * click it while it is red to connect, click it while it is green to
 * disconnect — and everything it used to explain is either in the tooltip or
 * in a toast at the moment it matters.
 *
 * The indicator stays deliberately binary: green only while a tunnel is
 * actually carrying traffic, red whenever it is not.
 */
const STATES = {
  disconnected: { label: 'VPN off', tone: 'off', icon: Shield },
  connecting: { label: 'Connecting…', tone: 'busy', icon: Loader2 },
  connected_global: { label: 'VPN on', tone: 'on', icon: ShieldCheck },
  // The user is signing in inside the FortiClient window. Not an error: the
  // indicator turns green by itself as soon as the tunnel appears.
  awaiting_forticlient: { label: 'Sign in…', tone: 'busy', icon: Loader2 },
  // Legacy state names kept so an older stored status never breaks the header.
  connected_in_app: { label: 'VPN on', tone: 'on', icon: ShieldCheck },
  connected_split: { label: 'VPN on', tone: 'on', icon: ShieldCheck },
  connected_full: { label: 'VPN on', tone: 'on', icon: ShieldCheck },
  error: { label: 'VPN error', tone: 'off', icon: ShieldAlert }
}

const TONES = {
  on: 'status-online-text bg-nord-14/15 ring-1 ring-nord-14/40 hover:bg-nord-14/25',
  off: 'text-nord-11 bg-nord-11/10 ring-1 ring-nord-11/30 hover:bg-nord-11/20',
  busy: 'text-[rgb(var(--primary))] bg-[rgb(var(--primary)/.12)] ring-1 ring-[rgb(var(--primary)/.3)]'
}

export default function VPNButton() {
  const status = useVpnStore()
  const setStatus = useVpnStore((s) => s.setStatus)
  const [busy, setBusy] = useState(false)

  const config = STATES[status.state] || STATES.disconnected
  const claimsConnected = String(status.state || '').startsWith('connected')
  // `live` is authoritative when the main process reports it.
  const live = status.live ?? claimsConnected
  const pending = busy || config.tone === 'busy'
  const tone = pending ? 'busy' : live ? 'on' : 'off'
  const label = pending ? config.label : live ? 'VPN on' : 'VPN off'
  const Icon = pending ? Loader2 : live ? ShieldCheck : config.icon === ShieldAlert ? ShieldAlert : Shield

  const refresh = useCallback(() => {
    const api = getApi()
    if (!api?.vpn?.status) return
    api.vpn.status().then(setStatus).catch(() => {})
  }, [setStatus])

  useEffect(() => {
    const api = getApi()
    if (!api?.vpn) return undefined
    refresh()
    const unsubscribe = api.vpn.subscribe(setStatus)
    // Poll once a second so the colour tracks reality even without events.
    const timer = setInterval(refresh, 1000)
    return () => {
      unsubscribe?.()
      clearInterval(timer)
    }
  }, [setStatus, refresh])

  const connect = async () => {
    setStatus({ state: 'connecting', mode: 'global' })
    try {
      const result = await getApi().vpn.connect('global')
      setStatus(result)
      if (result?.state === 'awaiting_forticlient') {
        toast.info('FortiClient is open — finish signing in there. This button turns green on its own once the tunnel is up.', { duration: 10000 })
      } else {
        toast.success('FortiClient VPN tunnel is active')
      }
    } catch (error) {
      setStatus({ state: 'error', mode: null, message: error.message })
      toast.error(error.message, {
        duration: 8000,
        action: /not installed/i.test(error.message)
          ? { label: 'Get FortiClient', onClick: () => getApi().app.openExternal('https://www.fortinet.com/support/product-downloads#vpn') }
          : undefined
      })
    }
  }

  const disconnect = async () => {
    try {
      setStatus(await getApi().vpn.disconnect())
      toast.success('VPN disconnected')
    } catch (error) { toast.error(error.message) }
  }

  const onClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (live) await disconnect()
      else await connect()
    } finally {
      setBusy(false)
    }
  }

  const title = pending
    ? config.label
    : live
      ? `Connected through FortiClient${status.gateway ? ` — ${status.gateway}` : ''}. Click to disconnect.`
      : 'Click to connect the FortiClient VPN tunnel'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={title}
      aria-label={`VPN status: ${label}. ${live ? 'Disconnect' : 'Connect'}`}
      data-vpn-live={live ? 'true' : 'false'}
      className={cn(
        'no-drag flex h-9 items-center gap-2 rounded-xl px-2.5 text-xs font-bold transition disabled:cursor-wait',
        TONES[tone]
      )}
    >
      <span className="relative flex items-center">
        <Icon size={16} className={pending ? 'animate-spin' : undefined} />
        <span
          aria-hidden
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[rgb(var(--surface))]',
            live ? 'bg-nord-14' : 'bg-nord-11',
            live && 'animate-pulse'
          )}
        />
      </span>
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
}
