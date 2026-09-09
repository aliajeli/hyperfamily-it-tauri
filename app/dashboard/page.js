'use client'

import { useState } from 'react'
import { Building2, Clock3, ChevronLeft, ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import AppShell from '@/components/layout/AppShell'
import BranchCard from '@/components/dashboard/BranchCard'
import BranchDetailsPanel from '@/components/dashboard/BranchDetailsPanel'
import { Skeleton, EmptyState } from '@/components/ui'
import { useDevicesStore } from '@/stores/devices.store'
import { useSettingsStore } from '@/stores/settings.store'

const BRANCHES_PER_PAGE = 4

export default function DashboardPage() {
  const { branches, devices, generatedAt } = useDevicesStore()
  const settings = useSettingsStore((state) => state.settings)
  const [page, setPage] = useState(1)
  const [selectedBranchId, setSelectedBranchId] = useState(null)
  const pageCount = Math.max(1, Math.ceil(branches.length / BRANCHES_PER_PAGE))
  const currentPage = Math.min(page, pageCount)
  const pageBranches = branches.slice((currentPage - 1) * BRANCHES_PER_PAGE, currentPage * BRANCHES_PER_PAGE)
  const compactBranches = settings.dashboard_branch_mode === 'always_compact' || branches.length > BRANCHES_PER_PAGE
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) || null
  const detailsView = settings.dashboard_branch_details_view === 'side_panel' ? 'side_panel' : 'modal'

  return (
    <AppShell compact>
      <div className="mx-auto max-w-[1920px] space-y-3 text-[13px]">
        <div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <motion.h1 initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="mr-1 text-xl font-extrabold tracking-[0.015em]">Network at a glance</motion.h1>
            <div className="ml-auto flex items-center gap-1.5 text-[9px] font-semibold text-[rgb(var(--muted))]">
              <Clock3 size={11} className={generatedAt ? 'text-[rgb(var(--primary))]' : 'animate-spin'} />
              {generatedAt ? `Updated ${new Date(generatedAt).toLocaleTimeString()}` : 'Connecting to monitor…'}
            </div>
          </div>
          <p className="mt-1 text-[10px] text-[rgb(var(--muted))]">Live health and Router latency across every store. Select a branch title to see all monitored equipment.</p>
        </div>

        {!generatedAt ? (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <Skeleton key={item} className={compactBranches ? 'h-[250px]' : 'h-[620px]'} />)}
          </div>
        ) : branches.length ? (
          <>
            <motion.div
              key={`${currentPage}-${compactBranches}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ staggerChildren: 0.05 }}
              className="grid items-start gap-2.5 sm:grid-cols-2 xl:grid-cols-4"
            >
              {pageBranches.map((branch, index) => (
                <BranchCard
                  key={branch.id}
                  branch={branch}
                  devices={devices}
                  compact={compactBranches}
                  index={index}
                  onOpenDetails={() => setSelectedBranchId(branch.id)}
                />
              ))}
            </motion.div>

            {pageCount > 1 && (
              <motion.nav initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center gap-2 pt-1" aria-label="Dashboard branch pages">
                <motion.button
                  type="button"
                  whileHover={{ x: -2, scale: 1.06 }}
                  whileTap={{ scale: 0.93 }}
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="grid h-7 w-7 place-items-center rounded-lg border bg-[rgb(var(--surface)/.55)] text-[rgb(var(--muted))] shadow-sm transition hover:text-[rgb(var(--text))] hover:shadow-md disabled:pointer-events-none disabled:opacity-35"
                  aria-label="Previous four branches"
                >
                  <ChevronLeft size={14} />
                </motion.button>
                <span className="min-w-20 text-center text-[9px] font-semibold text-[rgb(var(--muted))]">Page {currentPage} of {pageCount}</span>
                <motion.button
                  type="button"
                  whileHover={{ x: 2, scale: 1.06 }}
                  whileTap={{ scale: 0.93 }}
                  onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
                  disabled={currentPage === pageCount}
                  className="grid h-7 w-7 place-items-center rounded-lg border bg-[rgb(var(--surface)/.55)] text-[rgb(var(--muted))] shadow-sm transition hover:text-[rgb(var(--text))] hover:shadow-md disabled:pointer-events-none disabled:opacity-35"
                  aria-label="Next four branches"
                >
                  <ChevronRight size={14} />
                </motion.button>
              </motion.nav>
            )}
          </>
        ) : (
          <EmptyState icon={<Building2 />} title="No branches yet" description="Create the first branch, then add its network devices." />
        )}
      </div>

      <BranchDetailsPanel
        branch={selectedBranch}
        devices={devices}
        view={detailsView}
        onClose={() => setSelectedBranchId(null)}
      />
    </AppShell>
  )
}
