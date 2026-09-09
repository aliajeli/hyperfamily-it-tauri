'use client'

import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Shield, CheckCircle2, AlertTriangle, Download, RotateCcw, Save, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label } from '@/components/ui'
import { getApi } from '@/lib/api'

/**
 * VPN settings, reduced to the only thing the app still decides.
 *
 * Signing in happens inside the FortiClient window — that is where the gateway
 * profile, the credentials and any two-factor prompt already live — so keeping
 * a second copy of them here only invited them to disagree. All this screen
 * does now is answer "which executable do we launch?", and it answers that by
 * itself whenever FortiClient is installed in a standard location.
 */
export default function VPNSettings({ settings, onSaved }) {
  const [path, setPath] = useState(settings.forticlient_path || '')
  const [probe, setProbe] = useState(null)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)

  const detect = useCallback(async () => {
    setChecking(true)
    try {
      const result = await getApi().vpn.probe()
      setProbe(result)
      return result
    } catch {
      setProbe(null)
      return null
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => { detect() }, [detect])

  // An empty path means "detect automatically", which is the normal state.
  const auto = !path.trim()
  const effectivePath = auto ? probe?.path || '' : path.trim()

  const persist = async (value) => {
    setSaving(true)
    try {
      const next = await getApi().settings.save({ forticlient_path: value })
      onSaved(next)
      await detect()
      return true
    } catch (error) {
      toast.error(error.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const browse = async () => {
    const chosen = await getApi().dialog.selectFile({
      title: 'Select the FortiClient VPN executable',
      filters: [{ name: 'Windows executable', extensions: ['exe'] }]
    })
    if (!chosen) return
    setPath(chosen)
    if (await persist(chosen)) toast.success('FortiClient path saved')
  }

  const useDetected = async () => {
    setPath('')
    if (await persist('')) {
      const result = await detect()
      toast[result?.installed ? 'success' : 'warning'](
        result?.installed ? `Detected at ${result.path}` : 'FortiClient was not found — select it manually'
      )
    }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Shield size={15} />FortiClient VPN</CardTitle>
          <CardDescription className="text-[11px]">
            The app only needs to know which program to launch. Signing in, the gateway profile and two-factor codes are all handled inside the FortiClient window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <label className="block">
            <Label>
              Executable path
              <span className="ml-1 font-normal text-[rgb(var(--muted))]">{auto ? '(detected automatically)' : '(chosen manually)'}</span>
            </Label>
            <div className="flex gap-2">
              <Input
                aria-label="FortiClient executable path"
                className="font-mono text-[11px]"
                placeholder={probe?.path || 'C:\\Program Files\\Fortinet\\FortiClient\\FortiClient.exe'}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                onBlur={() => { if ((settings.forticlient_path || '') !== path.trim()) persist(path.trim()) }}
              />
              <Button type="button" variant="secondary" size="icon" onClick={browse} aria-label="Browse for the FortiClient executable">
                <FolderOpen size={16} />
              </Button>
            </div>
            {auto && probe?.path && (
              <span className="mt-1.5 block break-all font-mono text-[10px] text-[rgb(var(--muted))]">Using {probe.path}</span>
            )}
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={saving} onClick={() => persist(path.trim())}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save path'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={useDetected} disabled={checking}>
              <RotateCcw size={14} />Detect automatically
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2.5">
        <Card className="p-3">
          {checking ? (
            <div className="flex items-center gap-2 text-[11px] text-[rgb(var(--muted))]">
              <Loader2 size={15} className="animate-spin" />Looking for FortiClient…
            </div>
          ) : effectivePath ? (
            <div className="flex items-start gap-2">
              <div className="rounded-lg bg-nord-14/20 p-1.5 text-[#66834e]"><CheckCircle2 size={15} /></div>
              <div className="min-w-0">
                <b className="text-[11px]">FortiClient ready</b>
                <p className="mt-0.5 break-all font-mono text-[9.5px] leading-relaxed text-[rgb(var(--muted))]">{effectivePath}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className="rounded-lg bg-nord-13/20 p-1.5 text-[#8b6e1c]"><AlertTriangle size={15} /></div>
              <div className="min-w-0">
                <b className="text-[11px]">FortiClient not found</b>
                <p className="mt-0.5 text-[10px] leading-relaxed text-[rgb(var(--muted))]">
                  Install the FortiClient VPN client, or use Browse to point at it.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-1.5"
                  onClick={() => getApi().app.openExternal(probe?.downloadUrl || 'https://www.fortinet.com/support/product-downloads#vpn')}
                >
                  <Download size={13} />Get FortiClient
                </Button>
              </div>
            </div>
          )}
        </Card>

        <p className="px-1 text-[10px] leading-relaxed text-[rgb(var(--muted))]">
          The VPN button in the header launches this program and turns green on its own as soon as a tunnel appears. Click it again to disconnect.
        </p>
      </div>
    </div>
  )
}
