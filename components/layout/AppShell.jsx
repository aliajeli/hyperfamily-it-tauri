'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { getApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { useDevicesStore } from '@/stores/devices.store'
import { useUpdateStore } from '@/stores/update.store'
import Sidebar from './Sidebar'
import Header from './Header'

/**
 * The sidebar rail is measured in rem so that it tracks the interface scale
 * exactly like the content margin does. Mixing units here is what used to let
 * the rail overlap the page: a fixed 224px aside against a 14rem margin drifts
 * apart by 56px at 75 % scale and covers the left edge of every page.
 */
export const SIDEBAR_WIDTH = { expanded: '14rem', collapsed: '4.5rem' }

export default function AppShell({ children, compact = false }) {
  const router = useRouter()
  const { user, hydrated, logout } = useAuthStore()
  const setSnapshot = useDevicesStore((s) => s.setSnapshot)
  // The rail stays exactly as the user left it: collapsed until the collapse
  // button is clicked again — never expanded by a hover, a route change or a
  // restart (v2.0.16). The choice is remembered across sessions.
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem('hyperfamily.sidebar') === 'collapsed' } catch { return false }
  })

  useEffect(() => {
    try { window.localStorage.setItem('hyperfamily.sidebar', collapsed ? 'collapsed' : 'expanded') } catch { /* storage may be unavailable */ }
  }, [collapsed])

  useEffect(() => {
    if (hydrated && !user) router.replace('/login')
    if (hydrated && user) {
      getApi().auth.status().then(({ authenticated }) => {
        if (!authenticated) { logout(); router.replace('/login') }
      }).catch(() => { logout(); router.replace('/login') })
    }
  }, [hydrated, user, logout, router])

  useEffect(() => {
    if (!user) return
    let unsubscribe = () => {}
    getApi().monitor.snapshot().then(setSnapshot).catch(() => {})
    unsubscribe = getApi().monitor.subscribe(setSnapshot)
    return () => unsubscribe?.()
  }, [user, setSnapshot])

  // Automatic update check (v2.0.16): once on launch, then every six hours.
  // When a newer version exists, the Notification Center announces it with
  // its changelog and a toast points the operator at the About page.
  const setUpdateInfo = useUpdateStore((state) => state.setInfo)
  useEffect(() => {
    if (!user) return undefined
    const api = getApi()
    if (!api?.update?.check) return undefined
    let announced = false
    const runCheck = async () => {
      try {
        const result = await api.update.check()
        if (result?.hasUpdate) {
          setUpdateInfo(result)
          if (!announced) {
            announced = true
            toast.message('A new version is available', {
              description: `HyperFamily ${result.latestVersion} is ready — open the bell for the changelog.`,
              action: { label: 'View', onClick: () => router.push('/about') }
            })
          }
        }
      } catch { /* offline or a failed check must stay silent */ }
    }
    runCheck()
    const timer = setInterval(runCheck, 6 * 60 * 60 * 1000)
    return () => clearInterval(timer)
  }, [user, setUpdateInfo, router])

  const onLogout = async () => {
    await getApi().auth.logout().catch(() => {})
    logout()
    router.replace('/login')
  }

  if (!hydrated || !user) return <div className="grid min-h-screen place-items-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[rgb(var(--primary)/.25)] border-t-[rgb(var(--primary))]" /></div>

  const rail = collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded

  // A single custom property drives the rail width, the header offset and the
  // content margin, so the three can never disagree at any interface scale.
  return <div className="app-shell min-h-[100dvh]" style={{ '--rail': rail }}>
    <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} onLogout={onLogout} />
    <Header user={user} />
    <motion.main
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`app-main min-h-[100dvh] ${compact ? 'px-3 pb-20 pt-[68px] md:px-4 md:pb-4' : 'px-3 pb-20 pt-[72px] md:px-5 md:pb-6'}`}
    >{children}</motion.main>
  </div>
}
