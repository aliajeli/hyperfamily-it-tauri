'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Building2, FileDown, FileUp, Plus, RefreshCw, Route, Server, Trash2, Warehouse } from 'lucide-react'
import { toast } from 'sonner'
import AppShell from '@/components/layout/AppShell'
import BranchForm from '@/components/devices/BranchForm'
import BranchList from '@/components/devices/BranchList'
import DeviceForm from '@/components/devices/DeviceForm'
import DeviceList from '@/components/devices/DeviceList'
import DeviceTypePicker from '@/components/devices/DeviceTypePicker'
import { Button, Card, Dialog, Skeleton } from '@/components/ui'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { getApi } from '@/lib/api'

function DevicesPageInner() {
  const confirm = useConfirm()
  const [branches, setBranches] = useState([])
  const [devices, setDevices] = useState([])
  const [selectedBranchId, setSelectedBranchId] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dashboardSavingId, setDashboardSavingId] = useState(null)

  const load = async (preferredBranchId = null) => {
    try {
      const [branchRows, deviceRows] = await Promise.all([getApi().branches.list(), getApi().devices.list()])
      setBranches(branchRows)
      setDevices(deviceRows)
      setSelectedBranchId((current) => {
        const desired = preferredBranchId || current
        if (desired && branchRows.some((branch) => branch.id === desired)) return desired
        return branchRows[0]?.id || null
      })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  const searchParams = useSearchParams()
  useEffect(() => { load() }, [])

  // Deep links from the global search palette: /devices?branch=<id> or ?device=<id>
  useEffect(() => {
    if (!devices.length && !branches.length) return
    const deviceId = Number(searchParams.get('device'))
    const branchId = Number(searchParams.get('branch'))
    if (deviceId) {
      const device = devices.find((item) => item.id === deviceId)
      if (device) return setSelectedBranchId(device.branch_id)
    }
    if (branchId && branches.some((branch) => branch.id === branchId)) setSelectedBranchId(branchId)
  }, [searchParams, devices, branches])

  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) || null
  const branchDevices = useMemo(() => devices.filter((device) => device.branch_id === selectedBranchId), [devices, selectedBranchId])
  const deviceCounts = useMemo(() => devices.reduce((counts, device) => ({ ...counts, [device.branch_id]: (counts[device.branch_id] || 0) + 1 }), {}), [devices])
  const monitoredCount = branchDevices.filter((device) => device.is_dashboard_visible).length
  const hasRouter = branchDevices.some((device) => device.device_type === 'Router')

  const save = async (data) => {
    if (!dialog) return
    setSaving(true)
    try {
      if (dialog.kind === 'branch') {
        const result = await getApi().branches.save({ ...data, id: dialog.value?.id })
        toast.success(dialog.value ? 'Branch changes saved' : 'Branch created')
        setDialog(null)
        await load(result.id)
      } else if (dialog.kind === 'device' && selectedBranch) {
        const payload = {
          ...data,
          id: dialog.value?.id,
          branch_id: selectedBranch.id,
          device_type: dialog.type || dialog.value?.device_type
        }
        const result = await getApi().devices.save(payload)
        toast.success(dialog.value ? `${result.name} changes saved` : `${result.name} added to ${selectedBranch.name}`)
        setDialog(null)
        await load(selectedBranch.id)
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const removeBranch = async (branch) => {
    const ok = await confirm({
      title: `Delete ${branch.name}?`,
      description: 'The branch and every device recorded against it are permanently removed. This cannot be undone.',
      confirmLabel: 'Delete branch'
    })
    if (!ok) return
    try {
      await getApi().branches.remove(branch.id)
      toast.success('Branch deleted')
      await load()
    } catch (error) { toast.error(error.message) }
  }

  const removeDevice = async (device) => {
    const ok = await confirm({
      title: `Delete ${device.name || device.hostname || device.device_type}?`,
      description: `${device.ip} is removed from this branch along with its credential assignments.`,
      confirmLabel: 'Delete device'
    })
    if (!ok) return
    try {
      await getApi().devices.remove(device.id)
      toast.success('Device deleted')
      await load(selectedBranchId)
    } catch (error) { toast.error(error.message) }
  }

  /**
   * Removes EVERY branch and device. The confirmation is deliberately blunt —
   * this wipes the whole directory and cannot be undone.
   */
  const removeAll = async () => {
    if (!branches.length && !devices.length) {
      toast.info('There is nothing to delete')
      return
    }
    const ok = await confirm({
      title: 'Delete ALL branches and devices?',
      description: `This permanently removes all ${branches.length} branch${branches.length === 1 ? '' : 'es'} and ${devices.length} device${devices.length === 1 ? '' : 's'}, together with their history, switch ports and credential assignments. This cannot be undone.`,
      confirmLabel: 'Delete everything'
    })
    if (!ok) return
    try {
      const result = await getApi().branches.removeAll()
      toast.success(`Directory cleared — ${result?.branchCount ?? branches.length} branches and ${result?.deviceCount ?? devices.length} devices removed`)
      setSelectedBranchId(null)
      await load(null)
    } catch (error) { toast.error(error.message) }
  }

  const changeDashboardVisibility = async (device, isDashboardVisible) => {
    if (dashboardSavingId) return
    setDashboardSavingId(device.id)
    try {
      // Save the complete existing record so type-specific fields and normalized
      // Switch ports are preserved while only Dashboard visibility changes.
      const updated = await getApi().devices.save({
        ...device,
        is_dashboard_visible: isDashboardVisible
      })
      setDevices((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (error) {
      toast.error(`Dashboard visibility was not changed: ${error.message}`)
    } finally {
      setDashboardSavingId(null)
    }
  }

  const [directoryBusy, setDirectoryBusy] = useState(null)

  const downloadTemplate = async () => {
    setDirectoryBusy('template')
    try {
      const result = await getApi().directory.template()
      if (result?.canceled) return
      toast.success('Import template saved', { description: result.path })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setDirectoryBusy(null)
    }
  }

  const importDirectory = async () => {
    setDirectoryBusy('import')
    try {
      const result = await getApi().directory.import()
      if (result?.canceled) return
      const summary = [
        result.branches_added ? `${result.branches_added} branches added` : null,
        result.branches_updated ? `${result.branches_updated} branches updated` : null,
        result.devices_added ? `${result.devices_added} devices added` : null,
        result.devices_updated ? `${result.devices_updated} devices updated` : null,
        result.switch_ports_imported ? `${result.switch_ports_imported} switch ports` : null
      ].filter(Boolean).join(' · ')
      toast.success('Directory imported', { description: summary || 'The workbook contained no new rows.' })
      await load(selectedBranchId)
    } catch (error) {
      // Validation failures arrive as a multi-line list of offending rows.
      toast.error('Import failed', { description: error.message, duration: 12000 })
    } finally {
      setDirectoryBusy(null)
    }
  }

  const openAddDevice = () => {
    if (!selectedBranch) return
    setDialog({ kind: 'device', step: 'type', type: null, value: null })
  }

  const openEditDevice = (device) => {
    setSelectedBranchId(device.branch_id)
    setDialog({ kind: 'device', step: 'form', type: device.device_type, value: device })
  }

  const dialogTitle = dialog?.kind === 'branch'
    ? `${dialog.value ? 'Edit' : 'Add'} branch`
    : dialog?.step === 'type'
      ? 'Choose a device type'
      : `${dialog?.value ? 'Edit' : 'Add'} ${dialog?.type || 'device'}`

  const dialogDescription = dialog?.kind === 'branch'
    ? 'Define branch identity, Warehouse Code, network links, and responsible contacts.'
    : dialog?.step === 'type'
      ? 'Choose the equipment type. A branch can contain only one Router.'
      : 'Every saved device needs a Device Name. Review the information and save your changes.'

  return (
    <AppShell>
      <div className="mx-auto max-w-[1700px] space-y-3 text-[13px]">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-xl font-black tracking-tight">Branches &amp; Devices</h1>
            <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">Manage branch and equipment records, then connect to any device straight from the list.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => load(selectedBranchId)} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</Button>
            <Button size="sm" variant="secondary" onClick={downloadTemplate} disabled={Boolean(directoryBusy)} title="Save a blank workbook with one sheet per device type">
              <FileDown size={14} className={directoryBusy === 'template' ? 'animate-pulse' : ''} />Template
            </Button>
            <Button size="sm" variant="secondary" onClick={importDirectory} disabled={Boolean(directoryBusy)} title="Import branches and devices from a filled-in template">
              <FileUp size={14} className={directoryBusy === 'import' ? 'animate-pulse' : ''} />Import
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: 'branch', value: null })}><Plus size={14} />Add branch</Button>
            <Button
              size="sm"
              variant="danger"
              onClick={removeAll}
              disabled={loading || (!branches.length && !devices.length)}
              title="Permanently delete every branch and device"
              aria-label="Delete all branches and devices"
            >
              <Trash2 size={14} />Delete all
            </Button>
          </div>
        </div>

        {loading ? (
          <><Skeleton className="h-20" /><Skeleton className="h-[560px]" /></>
        ) : (
          <>
            <Card className="overflow-hidden p-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex shrink-0 items-center gap-2 border-r pr-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))]"><Building2 size={14} /></span>
                  <span><b className="block text-[11px]">Branches</b><small className="block text-[8px] text-[rgb(var(--muted))]">{branches.length} locations</small></span>
                </div>
                <BranchList
                  branches={branches}
                  selectedBranchId={selectedBranchId}
                  deviceCounts={deviceCounts}
                  onSelect={(branch) => setSelectedBranchId(branch.id)}
                  onEdit={(branch) => setDialog({ kind: 'branch', value: branch })}
                  onDelete={removeBranch}
                />
              </div>
            </Card>

            <Card className="min-w-0 overflow-hidden">
              {selectedBranch ? (
                <>
                  <div className="flex flex-col justify-between gap-2 border-b bg-gradient-to-r from-[rgb(var(--primary)/.09)] via-[rgb(var(--surface)/.68)] to-[rgb(var(--secondary)/.07)] px-3.5 py-2.5 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[rgb(var(--primary))] text-white"><Server size={14} /></span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <h2 className="truncate text-xs font-black tracking-[0.025em]">{selectedBranch.name}</h2>
                          <span className="rounded-md bg-[rgb(var(--surface)/.78)] px-1.5 py-0.5 font-mono text-[8px] font-bold">{selectedBranch.code}</span>
                          <span className="flex items-center gap-1 rounded-md bg-[rgb(var(--surface)/.78)] px-1.5 py-0.5 font-mono text-[8px] font-bold"><Warehouse size={8} />{selectedBranch.warehouse_code || 'Warehouse code not set'}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[8px] text-[rgb(var(--muted))]">{branchDevices.length} devices · {monitoredCount} on Dashboard · {selectedBranch.link1 || 'No primary link'}{selectedBranch.manager_name ? ` · ${selectedBranch.manager_name}` : ''}</p>
                      </div>
                    </div>
                    <Button size="sm" onClick={openAddDevice}><Plus size={14} />Add device</Button>
                  </div>

                  <div className="p-2.5 sm:p-3">
                    <DeviceList
                      devices={branchDevices}
                      branch={selectedBranch}
                      onEdit={openEditDevice}
                      onDelete={removeDevice}
                      onAdd={openAddDevice}
                      onDashboardChange={changeDashboardVisibility}
                      dashboardSavingId={dashboardSavingId}
                    />
                  </div>
                </>
              ) : (
                <div className="grid min-h-[400px] place-items-center p-8 text-center">
                  <div>
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))]"><Route size={23} /></div>
                    <h2 className="mt-3 text-base font-black">Start with a branch</h2>
                    <p className="mx-auto mt-1 max-w-md text-xs text-[rgb(var(--muted))]">Create the first branch with the labeled Add branch button above before adding equipment.</p>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}

        <Dialog
          open={Boolean(dialog)}
          onOpenChange={(open) => { if (!open && !saving) setDialog(null) }}
          title={dialogTitle}
          description={dialogDescription}
          className={dialog?.kind === 'device' ? 'max-w-6xl' : 'max-w-3xl'}
        >
          {dialog?.kind === 'branch' ? (
            <BranchForm value={dialog.value} onSubmit={save} saving={saving} />
          ) : dialog?.kind === 'device' && selectedBranch && dialog.step === 'type' ? (
            <DeviceTypePicker branch={selectedBranch} unavailableTypes={hasRouter ? ['Router'] : []} onSelect={(type) => setDialog({ ...dialog, step: 'form', type })} />
          ) : dialog?.kind === 'device' && selectedBranch ? (
            <DeviceForm
              key={`${dialog.value?.id || 'new'}-${dialog.type}`}
              value={dialog.value}
              branch={selectedBranch}
              deviceType={dialog.type}
              onSubmit={save}
              onBack={dialog.value ? null : () => setDialog({ ...dialog, step: 'type', type: null })}
              saving={saving}
            />
          ) : null}
        </Dialog>
      </div>
    </AppShell>
  )
}

export default function DevicesPage() {
  return <Suspense fallback={null}><DevicesPageInner /></Suspense>
}
