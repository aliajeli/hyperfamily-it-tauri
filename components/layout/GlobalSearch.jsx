'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, Command, CornerDownLeft, Server, Building2, Compass, LoaderCircle } from 'lucide-react'
import { getApi } from '@/lib/api'

const PAGES = [
  { id: 'page-dashboard', kind: 'page', label: 'Operations overview', hint: 'Dashboard', href: '/dashboard' },
  { id: 'page-gateway', kind: 'page', label: 'Gateway monitor', hint: 'Dashboard', href: '/dashboard/gateway' },
  { id: 'page-devices', kind: 'page', label: 'Branches & devices', hint: 'Manage', href: '/devices' },
  { id: 'page-inventory', kind: 'page', label: 'Asset inventory', hint: 'Manage', href: '/inventory' },
  { id: 'page-store-update', kind: 'page', label: 'Update Store App', hint: 'Tools', href: '/store-update' },
  { id: 'page-settings', kind: 'page', label: 'Application settings', hint: 'Configure', href: '/settings' },
  { id: 'page-about', kind: 'page', label: 'About & updates', hint: 'Help', href: '/about' }
]

const ICONS = { device: Server, branch: Building2, page: Compass }

export default function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState({ devices: [], branches: [] })
  const inputRef = useRef(null)
  const loadedRef = useRef(false)

  const load = useCallback(async () => {
    if (loadedRef.current) return
    setLoading(true)
    try {
      const api = getApi()
      const [devices, branches] = await Promise.all([api.devices.list(), api.branches.list()])
      setData({ devices: devices || [], branches: branches || [] })
      loadedRef.current = true
    } catch {
      setData({ devices: [], branches: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    load()
    setActive(0)
    const timer = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(timer)
  }, [open, load])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const branchName = (id) => data.branches.find((branch) => branch.id === id)?.name || ''

    const devices = data.devices.map((device) => ({
      id: `device-${device.id}`,
      kind: 'device',
      label: device.name || device.hostname || `${device.device_type} ${device.ip}`,
      hint: [device.device_type, device.ip, branchName(device.branch_id)].filter(Boolean).join(' · '),
      href: `/devices?device=${device.id}`,
      haystack: [device.name, device.hostname, device.ip, device.device_type, device.asset_code, device.serial_number, branchName(device.branch_id)].filter(Boolean).join(' ').toLowerCase()
    }))

    const branches = data.branches.map((branch) => ({
      id: `branch-${branch.id}`,
      kind: 'branch',
      label: branch.name,
      hint: [branch.code, branch.warehouse_code ? `WH ${branch.warehouse_code}` : null].filter(Boolean).join(' · '),
      href: `/devices?branch=${branch.id}`,
      haystack: [branch.name, branch.code, branch.warehouse_code].filter(Boolean).join(' ').toLowerCase()
    }))

    const pages = PAGES.map((page) => ({ ...page, haystack: `${page.label} ${page.hint}`.toLowerCase() }))
    const all = [...pages, ...branches, ...devices]
    if (!needle) return all.filter((item) => item.kind === 'page')
    return all.filter((item) => item.haystack.includes(needle)).slice(0, 24)
  }, [query, data])

  const go = (item) => {
    if (!item) return
    setOpen(false)
    setQuery('')
    router.push(item.href)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current) => (current + 1) % Math.max(results.length, 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => (current - 1 + results.length) % Math.max(results.length, 1)) }
    if (event.key === 'Enter') { event.preventDefault(); go(results[active]) }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open global search"
        className="group hidden h-9 w-56 items-center gap-2 rounded-xl border bg-[rgb(var(--surface)/.58)] px-3 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[rgb(var(--primary)/.35)] hover:bg-[rgb(var(--surface)/.8)] hover:shadow-md xl:flex"
      >
        <Search size={16} className="text-[rgb(var(--muted))] transition-transform duration-300 group-hover:scale-110 group-hover:text-[rgb(var(--primary))]" />
        <span className="w-full text-xs text-[rgb(var(--muted))]">Search devices…</span>
        <span className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] text-[rgb(var(--muted))]"><Command size={9} />K</span>
      </button>

      <button type="button" onClick={() => setOpen(true)} aria-label="Open global search" className="grid h-9 w-9 place-items-center rounded-xl border bg-[rgb(var(--surface)/.58)] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--text))] xl:hidden">
        <Search size={16} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="no-drag fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[12vh] backdrop-blur-sm"
            onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
          >
            <motion.div
              initial={{ opacity: 0, y: -12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: .98 }}
              transition={{ duration: .16 }}
              className="w-full max-w-xl overflow-hidden rounded-2xl border bg-[rgb(var(--surface))] shadow-2xl"
            >
              <div className="flex items-center gap-2.5 border-b px-3.5">
                <Search size={16} className="text-[rgb(var(--muted))]" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setActive(0) }}
                  onKeyDown={onKeyDown}
                  placeholder="Search devices, branches, or pages…"
                  className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-[rgb(var(--muted))]"
                />
                {loading && <LoaderCircle size={14} className="animate-spin text-[rgb(var(--muted))]" />}
                <kbd className="rounded-md border px-1.5 py-0.5 text-[9px] text-[rgb(var(--muted))]">ESC</kbd>
              </div>

              <div className="max-h-80 overflow-y-auto p-1.5">
                {results.length ? results.map((item, index) => {
                  const Icon = ICONS[item.kind] || Compass
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(item)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition ${index === active ? 'bg-[rgb(var(--primary)/.12)] text-[rgb(var(--text))]' : 'text-[rgb(var(--muted))] hover:bg-[rgb(var(--border)/.4)]'}`}
                    >
                      <Icon size={15} className={index === active ? 'text-[rgb(var(--primary))]' : ''} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-xs text-[rgb(var(--text))]">{item.label}</b>
                        {item.hint && <span className="block truncate text-[10px]">{item.hint}</span>}
                      </span>
                      {index === active && <CornerDownLeft size={12} />}
                    </button>
                  )
                }) : (
                  <p className="px-3 py-8 text-center text-xs text-[rgb(var(--muted))]">No matches for “{query}”.</p>
                )}
              </div>

              <div className="flex items-center justify-between border-t px-3.5 py-2 text-[9.5px] uppercase tracking-wider text-[rgb(var(--muted))]">
                <span>↑ ↓ to navigate · ⏎ to open</span>
                <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
