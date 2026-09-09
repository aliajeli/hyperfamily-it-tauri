'use client'

import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import GlobalSearch from './GlobalSearch'
import VPNButton from './VPNButton'
import NotificationCenter from './NotificationCenter'

const titles = { dashboard: 'Operations overview', devices: 'Branches & devices', inventory: 'Asset inventory', settings: 'Application settings', about: 'About this product' }

export default function Header({ user }) {
  const pathname = usePathname()
  const key = pathname.split('/')[1] || 'dashboard'
  return <header className="app-header drag-region fixed right-0 top-0 flex h-14 items-center justify-between border-b bg-[rgb(var(--canvas)/.76)] px-3.5 backdrop-blur-xl md:px-5">
    <motion.div key={key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}><h1 className="text-sm font-bold tracking-[0.02em] md:text-base">{titles[key] || 'HyperFamily'}</h1><p className="hidden text-[10px] uppercase tracking-widest text-[rgb(var(--muted))] sm:block">Infrastructure control center</p></motion.div>
    <div className="no-drag flex items-center gap-2.5">
      <GlobalSearch />
      <VPNButton />
      <NotificationCenter />
      <div className="hidden items-center gap-2 border-l pl-3 sm:flex"><motion.div whileHover={{ y: -2, rotate: -3, scale: 1.04 }} className="grid h-9 w-9 place-items-center rounded-xl bg-[rgb(var(--primary))] text-xs font-extrabold text-white shadow-md shadow-black/10">{user?.username?.slice(0, 2).toUpperCase() || 'AD'}</motion.div><div className="hidden lg:block"><p className="text-xs font-bold tracking-[0.025em]">{user?.username || 'Admin'}</p><p className="text-[9px] uppercase tracking-wider text-[rgb(var(--muted))]">Administrator</p></div></div>
    </div>
  </header>
}
