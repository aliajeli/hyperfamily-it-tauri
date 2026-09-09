'use client'

import { useEffect, useState } from 'react'
import { FolderOpen, MonitorCog, Router, Save, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Switch } from '@/components/ui'
import { getApi } from '@/lib/api'

/**
 * Where the external tools live.
 *
 * Only two questions remain on this tab — which TeamViewer and which Winbox to
 * launch — because how each device type is reached moved to Connections and
 * credential assignment moved to Assignments. Both paths are probed on mount
 * so the common case needs no typing at all.
 */
export default function DeviceSettings({ settings, onSaved }) {
  const [form, setForm] = useState({
    teamviewer_path: settings.teamviewer_path || '',
    teamviewer_password: settings.teamviewer_password || '',
    teamviewer_lan_mode: settings.teamviewer_lan_mode ?? true,
    winbox_path: settings.winbox_path || '',
    winbox_port: settings.winbox_port || 8291
  })
  const [probe, setProbe] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { getApi().remote.probe().then(setProbe).catch(() => setProbe(null)) }, [])

  const browse = async (key) => {
    const path = await getApi().dialog.selectFile({
      title: `Select the ${key === 'teamviewer_path' ? 'TeamViewer' : 'Winbox'} executable`,
      filters: [{ name: 'Windows executables', extensions: ['exe'] }]
    })
    if (path) setForm((current) => ({ ...current, [key]: path }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const next = await getApi().settings.save({ ...form, winbox_port: Number(form.winbox_port) })
      onSaved(next)
      toast.success('Device tool settings saved')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const Detected = ({ value }) => value
    ? <span className="mt-1 flex items-center gap-1.5 text-[10px] text-[#66834e]"><CheckCircle2 size={12} />Detected at {value}</span>
    : <span className="mt-1 flex items-center gap-1.5 text-[10px] text-[#8b6e1c]"><AlertTriangle size={12} />Not found in the default install locations</span>

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><MonitorCog size={15} />TeamViewer</CardTitle>
            <CardDescription className="text-[11px]">Executable, default password, and LAN connection behaviour.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <label>
              <Label>Executable path</Label>
              <div className="flex gap-2">
                <Input value={form.teamviewer_path} onChange={(e) => setForm({ ...form, teamviewer_path: e.target.value })} placeholder="C:\\Program Files\\TeamViewer\\TeamViewer.exe" />
                <Button type="button" variant="secondary" size="icon" onClick={() => browse('teamviewer_path')}><FolderOpen size={16} /></Button>
              </div>
              <Detected value={probe?.teamviewer} />
            </label>
            <label>
              <Label>Default password <span className="font-normal text-[rgb(var(--muted))]">(optional)</span></Label>
              <Input type="password" autoComplete="new-password" value={form.teamviewer_password} onChange={(e) => setForm({ ...form, teamviewer_password: e.target.value })} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border p-2.5">
              <span>
                <b className="text-xs">LAN connections</b>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-[rgb(var(--muted))]">Reach devices by IP instead of a TeamViewer ID. Enable “Incoming LAN connections” on the target too.</span>
              </span>
              <Switch checked={Boolean(form.teamviewer_lan_mode)} onCheckedChange={(value) => setForm({ ...form, teamviewer_lan_mode: value })} />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Router size={15} />MikroTik Winbox</CardTitle>
            <CardDescription className="text-[11px]">Winbox sessions open with the device IP, this port, and the credential assigned to the device.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <label>
              <Label>Executable path</Label>
              <div className="flex gap-2">
                <Input value={form.winbox_path} onChange={(e) => setForm({ ...form, winbox_path: e.target.value })} placeholder="C:\\Program Files\\Mikrotik\\Winbox\\winbox64.exe" />
                <Button type="button" variant="secondary" size="icon" onClick={() => browse('winbox_path')}><FolderOpen size={16} /></Button>
              </div>
              <Detected value={probe?.winbox} />
            </label>
            <label>
              <Label>Default connection port</Label>
              <Input type="number" min={1} max={65535} value={form.winbox_port} onChange={(e) => setForm({ ...form, winbox_port: e.target.value })} />
              <span className="mt-1 block text-[10px] text-[rgb(var(--muted))]">A port set on an individual device overrides this value.</span>
            </label>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}><Save size={15} />{saving ? 'Saving…' : 'Save device tool settings'}</Button>
        <p className="text-[11px] text-[rgb(var(--muted))]">Connection methods per device type live in the <b>Connections</b> tab, and credential assignment in <b>Assignments</b>.</p>
      </div>
    </div>
  )
}
