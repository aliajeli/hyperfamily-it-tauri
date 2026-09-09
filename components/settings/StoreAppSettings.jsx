'use client'

import { useState } from 'react'
import { Network, Store } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label } from '@/components/ui'
import { getApi } from '@/lib/api'
import { useSettingsStore } from '@/stores/settings.store'

export default function StoreAppSettings({ settings, onSaved }) {
  const setGlobalSettings = useSettingsStore((state) => state.setSettings)
  const [store, setStore] = useState({
    store_update_path: settings.store_update_path || 'C:\\Store Commerce\\Updates'
  })
  // Never prefill the password input. A blank input retains the stored secret.
  const [target, setTarget] = useState({
    target_domain: settings.target_domain || '',
    target_admin_user: settings.target_admin_user || '',
    target_admin_password: '',
    testHost: ''
  })
  const [passwordStored, setPasswordStored] = useState(Boolean(settings.target_admin_password))
  const [busy, setBusy] = useState('')

  const finishSettingsSave = (next) => {
    onSaved(next)
    setGlobalSettings(next)
  }

  const looksLikeDrivePath = (value) => /^[a-zA-Z]:[\\/].+/.test(String(value || '').trim())

  const saveStore = async (event) => {
    event.preventDefault()
    const normalized = {
      store_update_path: store.store_update_path.trim().replace(/[\\/]+$/, '')
    }
    if (!looksLikeDrivePath(normalized.store_update_path)) return toast.error('The deploy destination must look like C:\\Store Commerce\\Updates')
    setBusy('store')
    try {
      const next = await getApi().settings.save(normalized)
      setStore(normalized)
      finishSettingsSave(next)
      toast.success('Deploy destination saved')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy('')
    }
  }

  const saveTarget = async (event) => {
    event.preventDefault()
    const patch = {
      target_domain: target.target_domain.trim().replace(/\\+$/, ''),
      target_admin_user: target.target_admin_user.trim()
    }
    if (patch.target_admin_user && /[\\/@]/.test(patch.target_admin_user) === false && !patch.target_domain) {
      return toast.error('Enter the domain of the target machines (for example okcs), or type the user as okcs\\administrator')
    }
    // An untouched password box must not wipe the stored secret.
    if (target.target_admin_password) patch.target_admin_password = target.target_admin_password
    else if (!passwordStored && patch.target_admin_user) return toast.error('Enter the password for the target account')
    setBusy('target')
    try {
      const next = await getApi().settings.save(patch)
      if (patch.target_admin_password) setPasswordStored(true)
      setTarget({ ...target, ...patch, target_admin_password: '' })
      finishSettingsSave(next)
      toast.success('Target access saved')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy('')
    }
  }

  const testTarget = async () => {
    const host = target.testHost.trim()
    if (!host) return toast.error('Enter the hostname or IP of one checkout to test against')
    setBusy('target-test')
    try {
      const result = await getApi().storeUpdate.testAccess({
        host,
        domain: target.target_domain.trim(),
        username: target.target_admin_user.trim(),
        // Test what is typed if the operator changed it, otherwise the stored one.
        password: target.target_admin_password || undefined
      })
      toast.success(`${result.host} accepted ${result.user} — admin share reachable in ${result.durationMs} ms`)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="grid items-start gap-3">
      <Card>
        <CardHeader className="p-3 pb-1.5">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-nord-14/15 p-2 text-nord-14"><Store size={16} /></div>
            <div>
              <CardTitle className="text-sm">Deploy destination</CardTitle>
              <CardDescription className="mt-0.5 text-[11px] leading-snug">
                Choose where update files are deployed on each checkout through its Windows admin share. Select the installed product on the Update Store App page.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-1.5">
          <form onSubmit={saveStore} className="space-y-2.5">
            <div className="grid gap-2.5">
              <div className="min-w-0">
                <Label htmlFor="deploy-destination">Deploy destination folder</Label>
                <Input id="deploy-destination" aria-describedby="deploy-destination-help" disabled={Boolean(busy)} className="font-mono text-[12px]" dir="ltr" value={store.store_update_path} onChange={(event) => setStore({ ...store, store_update_path: event.target.value })} placeholder="C:\Store Commerce\Updates" />
                <p id="deploy-destination-help" className="mt-0.5 text-[9.5px] leading-snug text-[rgb(var(--muted))]">Use a local folder on the checkout, not a folder on this workstation. Existing files receive a dated backup before replacement.</p>
              </div>
            </div>
            <Button disabled={Boolean(busy)}>{busy === 'store' ? 'Saving…' : 'Save deploy destination'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-3 pb-1.5">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-nord-13/15 p-2 text-nord-13"><Network size={16} /></div>
            <div>
              <CardTitle className="text-sm">Target access — administrator account on the checkouts</CardTitle>
              <CardDescription className="mt-0.5 text-[11px] leading-snug">
                Use an account with local administrator rights on the checkouts, including machines in another domain. Credentials are stored encrypted at rest and used for Windows authentication when accessing admin shares and managing the Agent service.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-1.5">
          <form onSubmit={saveTarget} className="space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div className="min-w-0">
                <Label htmlFor="target-domain">Target domain</Label>
                <Input id="target-domain" aria-describedby="target-domain-help" disabled={Boolean(busy)} dir="ltr" value={target.target_domain} onChange={(event) => setTarget({ ...target, target_domain: event.target.value })} placeholder="okcs" />
                <p id="target-domain-help" className="mt-0.5 text-[9.5px] leading-snug text-[rgb(var(--muted))]">The domain of the checkouts, not the one this PC is joined to.</p>
              </div>
              <div className="min-w-0">
                <Label htmlFor="target-username">Username</Label>
                <Input id="target-username" aria-describedby="target-username-help" disabled={Boolean(busy)} dir="ltr" autoComplete="off" value={target.target_admin_user} onChange={(event) => setTarget({ ...target, target_admin_user: event.target.value })} placeholder="administrator" />
                <p id="target-username-help" className="mt-0.5 text-[9.5px] leading-snug text-[rgb(var(--muted))]">Use domain\username, user@domain, or a username with the target domain above.</p>
              </div>
              <div className="min-w-0">
                <Label htmlFor="target-password">Password</Label>
                <Input id="target-password" aria-describedby="target-password-help" disabled={Boolean(busy)} type="password" dir="ltr" autoComplete="new-password" value={target.target_admin_password} onChange={(event) => setTarget({ ...target, target_admin_password: event.target.value })} placeholder={passwordStored ? 'Stored — leave empty to keep it' : 'Password'} />
                <p id="target-password-help" className="mt-0.5 text-[9.5px] leading-snug text-[rgb(var(--muted))]">{passwordStored ? 'A password is stored; typing here replaces it.' : 'Required before the first sweep.'}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2.5">
              <div className="min-w-0 flex-1 sm:max-w-[260px]">
                <Label htmlFor="target-test-host">Test against one checkout</Label>
                <Input id="target-test-host" disabled={Boolean(busy)} dir="ltr" value={target.testHost} onChange={(event) => setTarget({ ...target, testHost: event.target.value })} placeholder="CO-01 or 10.10.1.5" />
              </div>
              <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={testTarget}>
                {busy === 'target-test' ? 'Testing…' : 'Test access'}
              </Button>
              <Button disabled={Boolean(busy)}>{busy === 'target' ? 'Saving…' : 'Save target access'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
