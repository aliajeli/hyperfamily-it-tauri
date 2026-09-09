'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, Download, Search, SlidersHorizontal, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import AppShell from '@/components/layout/AppShell'
import InventoryTable from '@/components/inventory/InventoryTable'
import { Button, Card, Input, Select, Skeleton } from '@/components/ui'
import { DEVICE_TYPES } from '@/lib/constants'
import { getApi } from '@/lib/api'

function matchesQuery(device, query) {
  if (!query) return true
  const needle = query.toLowerCase()
  const values = [
    device.name, device.hostname, device.ip, device.port, device.model, device.asset_code, device.serial_number,
    device.location, device.connection_type, device.connection_port, device.esxi_version, device.version,
    device.user, device.domain, device.checkout_number, device.brand, device.terminal_id, device.acceptance_id,
    device.branch_name, device.branch_code, device.branch_warehouse_code,
    ...(device.switch_ports || []).flatMap((port) => [port.port_number, port.vlan, port.status, port.ip, port.details])
  ]
  return values.some((value) => String(value || '').toLowerCase().includes(needle))
}

export default function InventoryPage() {
  const [devices, setDevices] = useState([])
  const [branches, setBranches] = useState([])
  const [filters, setFilters] = useState({ branch: 'all', type: 'all', query: '' })
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const loadInventory = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const [nextDevices, nextBranches] = await Promise.all([getApi().inventory.list(), getApi().branches.list()])
      setDevices(nextDevices)
      setBranches(nextBranches)
    } catch (error) {
      toast.error(error.message)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => { loadInventory(true) }, [loadInventory])

  const filtered = useMemo(() => devices.filter((device) => (
    (filters.branch === 'all' || String(device.branch_id) === filters.branch)
    && (filters.type === 'all' || device.device_type === filters.type)
    && matchesQuery(device, filters.query)
  )), [devices, filters])

  const onlineCount = useMemo(() => filtered.filter((device) => device.status === 'online').length, [filtered])

  const exportExcel = async () => {
    setExporting(true)
    try {
      const result = await getApi().inventory.export({ branch: filters.branch, type: filters.type, query: filters.query })
      if (result?.path) toast.success(`Export saved to ${result.path}`)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1700px] space-y-3">
        <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
          <div>
            <h1 className="page-title">Asset inventory</h1>
            <p className="page-subtitle">Filter hardware, connect to any device, or export an operational snapshot.</p>
          </div>
          <Button onClick={exportExcel} disabled={!filtered.length || exporting}>
            <Download size={16} />{exporting ? 'Exporting…' : `Export ${filtered.length} to Excel`}
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Card className="flex items-center gap-3 p-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-nord-8/15 text-nord-10"><Boxes size={17} /></div>
            <div><p className="text-[10px] uppercase tracking-wider text-[rgb(var(--muted))]">Total assets</p><b className="text-lg">{devices.length}</b></div>
          </Card>
          <Card className="flex items-center gap-3 p-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-nord-14/15 text-[#66834e]"><SlidersHorizontal size={17} /></div>
            <div><p className="text-[10px] uppercase tracking-wider text-[rgb(var(--muted))]">Filtered results</p><b className="text-lg">{filtered.length}</b></div>
          </Card>
          <Card className="flex items-center gap-3 p-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-nord-15/15 text-nord-15"><Wifi size={17} /></div>
            <div><p className="text-[10px] uppercase tracking-wider text-[rgb(var(--muted))]">Online in view</p><b className="text-lg">{onlineCount}</b></div>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="grid gap-2 border-b p-3 md:grid-cols-[1fr_190px_190px]">
            <label className="relative">
              <Search size={16} className="absolute left-3.5 top-3 text-[rgb(var(--muted))]" />
              <Input className="pl-10" placeholder="Search device, branch, port, or identifier…" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
            </label>
            <Select value={filters.branch} onChange={(event) => setFilters({ ...filters, branch: event.target.value })}>
              <option value="all">All branches</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
            <Select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
              <option value="all">All device types</option>
              {DEVICE_TYPES.map((type) => <option key={type}>{type}</option>)}
            </Select>
          </div>
          {loading
            ? <div className="space-y-3 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div>
            : <InventoryTable devices={filtered} />}
        </Card>
      </div>
    </AppShell>
  )
}
