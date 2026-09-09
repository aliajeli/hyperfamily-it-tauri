'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Search, Layers, MonitorSmartphone, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Input, EmptyState, Select } from '@/components/ui'
import { DEVICE_TYPES } from '@/lib/constants'
import { getApi } from '@/lib/api'

/**
 * Credential assignment.
 *
 * Split out of the Credentials tab so that creating a credential and handing
 * it to equipment are two separate jobs on two separate screens — the combined
 * tab had grown to four stacked cards and could not be seen without scrolling.
 *
 * Every row still writes immediately through a single-device IPC call, so an
 * assignment can never be lost by forgetting a Save button, and nothing that
 * was not touched is ever rewritten.
 */
export default function AssignmentsSettings() {
  const [credentials, setCredentials] = useState([])
  const [rows, setRows] = useState([])
  const [typeDefaults, setTypeDefaults] = useState({})
  const [branches, setBranches] = useState([])
  const [branchFilter, setBranchFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [busyKey, setBusyKey] = useState(null)
  const [savedKey, setSavedKey] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const api = getApi()
      if (!api) return
      const [credentialList, branchList, overview, map] = await Promise.all([
        api.credentials.list(),
        api.branches.list(),
        api.credentials.overview(),
        api.credentials.map()
      ])
      setCredentials(credentialList)
      setBranches(branchList)
      setRows(overview)
      const defaults = {}
      for (const [type, ids] of Object.entries(map?.types || {})) if (ids?.length) defaults[type] = ids[0]
      setTypeDefaults(defaults)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (key) => {
    setSavedKey(key)
    setTimeout(() => setSavedKey((current) => (current === key ? null : current)), 1600)
  }

  const assignDevice = async (device, rawValue) => {
    const credentialId = rawValue === '' ? null : Number(rawValue)
    const key = `device-${device.device_id}`
    setBusyKey(key)
    // Optimistic update so the dropdown never snaps back while saving.
    setRows((current) => current.map((row) => row.device_id === device.device_id
      ? { ...row, credential_id: credentialId } : row))
    try {
      await getApi().credentials.assignDevice(device.device_id, credentialId)
      await load()
      flash(key)
    } catch (error) {
      toast.error(error.message)
      await load()
    } finally { setBusyKey(null) }
  }

  const assignType = async (type, rawValue) => {
    const credentialId = rawValue === '' ? null : Number(rawValue)
    const key = `type-${type}`
    setBusyKey(key)
    setTypeDefaults((current) => ({ ...current, [type]: credentialId ?? undefined }))
    try {
      await getApi().credentials.assignType(type, credentialId)
      await load()
      flash(key)
    } catch (error) {
      toast.error(error.message)
      await load()
    } finally { setBusyKey(null) }
  }

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (branchFilter !== 'all' && String(row.branch_id) !== branchFilter) return false
      if (typeFilter !== 'all' && row.device_type !== typeFilter) return false
      if (!needle) return true
      return [row.device_name, row.ip, row.device_type, row.branch_name, row.effective_name]
        .some((value) => String(value || '').toLowerCase().includes(needle))
    })
  }, [rows, branchFilter, typeFilter, query])

  const unassignedCount = rows.filter((row) => row.source === 'none').length

  const statusCell = (row) => {
    if (row.source === 'device') return <span className="rounded bg-[rgb(var(--primary)/.16)] px-1.5 py-0.5 text-[9.5px] font-bold text-[rgb(var(--primary))]">Set for this device</span>
    if (row.source === 'type') return <span className="rounded bg-[rgb(var(--border)/.6)] px-1.5 py-0.5 text-[9.5px] font-medium text-[rgb(var(--muted))]">From {row.device_type} default</span>
    return <span className="rounded bg-nord-11/15 px-1.5 py-0.5 text-[9.5px] font-bold text-nord-11">No credential</span>
  }

  if (!loading && !credentials.length) {
    return (
      <Card>
        <CardContent className="p-4">
          <EmptyState
            icon={<KeyRound />}
            title="No credentials yet"
            description="Create an encrypted credential in the Credentials tab, then come back here to assign it to device types and individual devices."
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Layers size={15} />Default per device type</CardTitle>
          <CardDescription className="text-[11px]">
            Pick one credential per type and every device of that type uses it automatically. Changes save instantly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1.5 sm:grid-cols-3 xl:grid-cols-5">
            {DEVICE_TYPES.map((type) => {
              const key = `type-${type}`
              return (
                <div key={type} className="rounded-lg border p-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <b className="truncate text-[10px]">{type}</b>
                    {busyKey === key && <Loader2 size={11} className="shrink-0 animate-spin text-[rgb(var(--muted))]" />}
                    {savedKey === key && <Check size={12} className="shrink-0 text-nord-14" />}
                  </div>
                  <Select
                    aria-label={`Default credential for ${type}`}
                    className="mt-1 h-7 w-full text-[10.5px]"
                    value={typeDefaults[type] ?? ''}
                    onChange={(event) => assignType(type, event.target.value)}
                  >
                    <option value="">No default</option>
                    {credentials.map((credential) => (
                      <option key={credential.id} value={credential.id}>{credential.name}</option>
                    ))}
                  </Select>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><MonitorSmartphone size={15} />Per-device credential</CardTitle>
          <CardDescription className="text-[11px]">
            Only for exceptions — a device set here overrides its type default.
            {unassignedCount > 0 && <> <b className="text-nord-11">{unassignedCount} device{unassignedCount === 1 ? '' : 's'} still have no credential.</b></>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
              <Input className="h-7 w-48 pl-7 text-[11px]" placeholder="Search devices" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Select aria-label="Filter by branch" className="h-7 w-36 text-[11px]" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="all">All branches</option>
              {branches.map((branch) => <option key={branch.id} value={String(branch.id)}>{branch.name}</option>)}
            </Select>
            <Select aria-label="Filter by device type" className="h-7 w-32 text-[11px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              {DEVICE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </Select>
            <span className="ml-auto text-[10.5px] text-[rgb(var(--muted))]">{visibleRows.length} shown</span>
          </div>

          <div className="mt-2 max-h-[15rem] overflow-y-auto rounded-lg border">
            {loading ? (
              <p className="p-5 text-center text-[11px] text-[rgb(var(--muted))]">Loading devices…</p>
            ) : visibleRows.length ? (
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 z-10 bg-[rgb(var(--surface))]">
                  <tr className="border-b text-[9.5px] uppercase tracking-wider text-[rgb(var(--muted))]">
                    <th className="py-1.5 pl-2.5">Device</th>
                    <th className="py-1.5">Type</th>
                    <th className="py-1.5">Branch</th>
                    <th className="py-1.5">Status</th>
                    <th className="py-1.5 pr-2.5">Credential</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const key = `device-${row.device_id}`
                    return (
                      <tr key={row.device_id} className="border-b transition last:border-0 hover:bg-[rgb(var(--border)/.25)]">
                        <td className="py-1 pl-2.5">
                          <div className="font-semibold">{row.device_name}</div>
                          <div className="font-mono text-[9.5px] text-[rgb(var(--muted))]">{row.ip}</div>
                        </td>
                        <td className="py-1 text-[rgb(var(--muted))]">{row.device_type}</td>
                        <td className="py-1 text-[rgb(var(--muted))]">{row.branch_name}</td>
                        <td className="py-1">{statusCell(row)}</td>
                        <td className="py-1 pr-2.5">
                          <div className="flex items-center gap-1.5">
                            <Select
                              aria-label={`Credential for ${row.device_name} (${row.ip})`}
                              className="h-7 w-44 text-[11px]"
                              value={row.credential_id ?? ''}
                              onChange={(event) => assignDevice(row, event.target.value)}
                            >
                              <option value="">
                                {row.source === 'type' ? `Use ${row.device_type} default` : 'Not set'}
                              </option>
                              {credentials.map((credential) => (
                                <option key={credential.id} value={credential.id}>{credential.name}</option>
                              ))}
                            </Select>
                            {busyKey === key && <Loader2 size={12} className="animate-spin text-[rgb(var(--muted))]" />}
                            {savedKey === key && <Check size={13} className="text-nord-14" />}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <p className="p-5 text-center text-[11px] text-[rgb(var(--muted))]">No devices match these filters.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
