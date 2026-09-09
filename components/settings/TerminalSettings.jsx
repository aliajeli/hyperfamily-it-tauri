'use client'

import { useState } from 'react'
import { Globe, Save, TerminalSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Switch } from '@/components/ui'
import { getApi } from '@/lib/api'

export default function TerminalSettings({ settings, onSaved }) {
  const [form, setForm] = useState({
    terminal_font_size: settings.terminal_font_size || 14,
    terminal_ssh_port: settings.terminal_ssh_port || 22,
    terminal_telnet_port: settings.terminal_telnet_port || 23,
    webview_autologin: settings.webview_autologin ?? true
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const next = await getApi().settings.save({
        ...form,
        terminal_font_size: Number(form.terminal_font_size),
        terminal_ssh_port: Number(form.terminal_ssh_port),
        terminal_telnet_port: Number(form.terminal_telnet_port)
      })
      onSaved(next)
      toast.success('Terminal and web settings saved')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3.5">
      <div className="grid gap-3.5 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><TerminalSquare size={17} />Switch terminal</CardTitle>
            <CardDescription className="text-xs">Defaults for the built-in SSH and Telnet console. A port set on an individual switch always wins.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <Label>Default SSH port</Label>
                <Input type="number" min={1} max={65535} value={form.terminal_ssh_port} onChange={(e) => setForm({ ...form, terminal_ssh_port: e.target.value })} />
              </label>
              <label>
                <Label>Default Telnet port</Label>
                <Input type="number" min={1} max={65535} value={form.terminal_telnet_port} onChange={(e) => setForm({ ...form, terminal_telnet_port: e.target.value })} />
              </label>
            </div>
            <label>
              <Label>Console font size</Label>
              <Input type="number" min={9} max={24} value={form.terminal_font_size} onChange={(e) => setForm({ ...form, terminal_font_size: e.target.value })} />
              <span className="mt-1.5 block text-[10px] text-[rgb(var(--muted))]">The terminal screen also has a per-session font size selector.</span>
            </label>
            <p className="rounded-xl border border-dashed p-3 text-[11px] leading-relaxed text-[rgb(var(--muted))]">
              Whether a switch connects over SSH or Telnet comes from its <b>Terminal protocol</b> field in Branches &amp; devices. The credential assigned to the <b>Switch</b> device type (or to the individual switch) is used to log in.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Globe size={17} />Embedded web sessions</CardTitle>
            <CardDescription className="text-xs">iLO and NVR devices open in an in-app browser window themed to match the application.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center justify-between rounded-xl border p-3">
              <span>
                <b className="text-xs">Sign in automatically</b>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-[rgb(var(--muted))]">Fill the device login form with the assigned credential and submit it as soon as the page loads. Turn this off to type the password yourself.</span>
              </span>
              <Switch checked={Boolean(form.webview_autologin)} onCheckedChange={(value) => setForm({ ...form, webview_autologin: value })} />
            </label>
            <p className="rounded-xl border border-dashed p-3 text-[11px] leading-relaxed text-[rgb(var(--muted))]">
              Embedded sessions share one isolated browser profile, so cookies stay separate from your normal browser. Self-signed certificates on iLO and NVR appliances are accepted automatically.
            </p>
          </CardContent>
        </Card>
      </div>

      <Button onClick={save} disabled={saving}><Save size={15} />{saving ? 'Saving…' : 'Save terminal and web settings'}</Button>
    </div>
  )
}
