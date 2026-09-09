'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, EmptyState } from '@/components/ui'
import { getApi } from '@/lib/api'
import { useConfirm } from '@/components/ui/ConfirmDialog'

/**
 * The credential vault: create, inspect and delete. Nothing else.
 *
 * Handing a credential to a device type or an individual device is a different
 * job with a different rhythm — it is done once per fleet change, not once per
 * password — so it now lives in the Assignments tab. Keeping both here made a
 * four-card screen that could not be read without scrolling.
 */
export default function CredentialsSettings() {
  const confirm = useConfirm()
  const [credentials, setCredentials] = useState([])
  const [usage, setUsage] = useState({ devices: {}, types: {} })
  const [form, setForm] = useState({ name: '', username: '', password: '' })
  const [revealed, setRevealed] = useState({})

  const load = useCallback(async () => {
    try {
      const api = getApi()
      if (!api) return
      const [credentialList, overview, map] = await Promise.all([
        api.credentials.list(),
        api.credentials.overview(),
        api.credentials.map()
      ])
      setCredentials(credentialList)
      // Count where each credential is in use, so deleting one is never a
      // guess about what it might break.
      const devices = {}
      for (const row of overview) if (row.credential_id) devices[row.credential_id] = (devices[row.credential_id] || 0) + 1
      const types = {}
      for (const ids of Object.values(map?.types || {})) if (ids?.length) types[ids[0]] = (types[ids[0]] || 0) + 1
      setUsage({ devices, types })
    } catch (error) {
      toast.error(error.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const add = async (event) => {
    event.preventDefault()
    try {
      await getApi().credentials.save(form)
      setForm({ name: '', username: '', password: '' })
      await load()
      toast.success('Credential encrypted and saved')
    } catch (error) { toast.error(error.message) }
  }

  const remove = async (credential) => {
    const ok = await confirm({
      title: `Delete “${credential.name}”?`,
      description: 'Any device using this credential falls back to its device-type credential.',
      confirmLabel: 'Delete credential'
    })
    if (!ok) return
    try {
      await getApi().credentials.remove(credential.id)
      await load()
      toast.success('Credential deleted')
    } catch (error) { toast.error(error.message) }
  }

  const toggleReveal = async (credential) => {
    if (revealed[credential.id]) return setRevealed({ ...revealed, [credential.id]: '' })
    try {
      const password = await getApi().credentials.reveal(credential.id)
      setRevealed((current) => ({ ...current, [credential.id]: password }))
      setTimeout(() => setRevealed((current) => ({ ...current, [credential.id]: '' })), 15000)
    } catch (error) { toast.error(error.message) }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Plus size={15} />Add credential</CardTitle>
          <CardDescription className="text-[11px]">Passwords are encrypted with Windows DPAPI before SQLite storage.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="space-y-2">
            <label className="block"><Label>Credential name</Label><Input required placeholder="Branch administrators" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="block"><Label>Username</Label><Input required autoComplete="off" placeholder="DOMAIN\username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
            <label className="block"><Label>Password</Label><Input required type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            <Button className="w-full"><KeyRound size={15} />Encrypt and save</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Saved credentials</CardTitle>
          <CardDescription className="text-[11px]">
            Revealed passwords hide again after 15 seconds. Assign them to equipment in the <b>Assignments</b> tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {credentials.length ? (
            <div className="max-h-[22rem] overflow-y-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 z-10 bg-[rgb(var(--surface))]">
                  <tr className="border-b text-[9.5px] uppercase tracking-wider text-[rgb(var(--muted))]">
                    <th className="py-1.5">Name</th>
                    <th className="py-1.5">Username</th>
                    <th className="py-1.5">Password</th>
                    <th className="py-1.5">In use by</th>
                    <th className="py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {credentials.map((credential) => {
                    const deviceCount = usage.devices[credential.id] || 0
                    const typeCount = usage.types[credential.id] || 0
                    return (
                      <tr key={credential.id} className="border-b transition last:border-0 hover:bg-[rgb(var(--border)/.3)]">
                        <td className="py-1.5 font-bold">{credential.name}</td>
                        <td className="py-1.5 font-mono">{credential.username}</td>
                        <td className="py-1.5 font-mono">{revealed[credential.id] || '••••••••'}</td>
                        <td className="py-1.5 text-[10.5px] text-[rgb(var(--muted))]">
                          {deviceCount || typeCount
                            ? [deviceCount ? `${deviceCount} device${deviceCount === 1 ? '' : 's'}` : null,
                               typeCount ? `${typeCount} type default${typeCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
                            : 'Not assigned'}
                        </td>
                        <td className="py-1.5">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleReveal(credential)} aria-label={`${revealed[credential.id] ? 'Hide' : 'Reveal'} password for ${credential.name}`}>{revealed[credential.id] ? <EyeOff size={14} /> : <Eye size={14} />}</Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-nord-11" onClick={() => remove(credential)} aria-label={`Delete ${credential.name}`}><Trash2 size={14} /></Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<KeyRound />} title="No credentials" description="Create an encrypted credential to enable one-click remote connections." />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
