'use client'

import { useState } from 'react'
import { Check, LayoutDashboard, Maximize2, PanelRightOpen, Rows3, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui'
import { getApi } from '@/lib/api'
import { useSettingsStore } from '@/stores/settings.store'

/**
 * How the dashboard presents branches.
 *
 * Moved out of General in v2.0.12: the account and monitoring cards belong to
 * the day-to-day administration surface, while this decides how the whole
 * dashboard *looks*, so it deserves its own tab beside Theme and Fonts.
 */

const branchModes = [
  {
    value: 'compact_over_four',
    icon: Rows3,
    title: 'Compact after four branches',
    description: 'Equipment shows inside cards for up to four branches; beyond that, only the Router chart.'
  },
  {
    value: 'always_compact',
    icon: LayoutDashboard,
    title: 'Always compact',
    description: 'Cards always show only the Router chart. Select a branch title to see equipment.'
  }
]

const detailViews = [
  {
    value: 'modal',
    icon: Maximize2,
    title: 'Large popup',
    description: 'Open branch equipment in a spacious centered panel.'
  },
  {
    value: 'side_panel',
    icon: PanelRightOpen,
    title: 'Side panel',
    description: 'Slide branch equipment in from the right side.'
  }
]

function Choice({ selected, icon: Icon, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative h-full overflow-hidden rounded-xl border p-2.5 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${
        selected
          ? 'border-[rgb(var(--primary)/.55)] bg-[rgb(var(--primary)/.09)] shadow-md shadow-black/5'
          : 'bg-[rgb(var(--surface)/.48)] hover:border-[rgb(var(--primary)/.3)] hover:bg-[rgb(var(--surface)/.8)]'
      }`}
    >
      <span aria-hidden="true" className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-[rgb(var(--primary)/.1)] blur-2xl transition-transform duration-500 group-hover:scale-150" />
      <div className="relative flex items-start gap-2.5">
        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-all duration-300 group-hover:rotate-[-5deg] group-hover:scale-105 ${selected ? 'bg-[rgb(var(--primary))] text-white shadow-md' : 'bg-[rgb(var(--border)/.5)] text-[rgb(var(--muted))]'}`}>
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold tracking-[0.025em]">{title}</p>
          <p className="mt-0.5 text-[9.5px] leading-[1.35] text-[rgb(var(--muted))]">{description}</p>
        </div>
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-all duration-300 ${selected ? 'scale-100 border-[rgb(var(--primary))] bg-[rgb(var(--primary))] text-white' : 'scale-90 text-transparent'}`}>
          <Check size={12} strokeWidth={3} />
        </span>
      </div>
    </button>
  )
}

export default function DashboardSettings({ settings, onSaved }) {
  const setGlobalSettings = useSettingsStore((state) => state.setSettings)
  const [dashboard, setDashboard] = useState({
    dashboard_branch_mode: settings.dashboard_branch_mode === 'always_compact' ? 'always_compact' : 'compact_over_four',
    dashboard_branch_details_view: settings.dashboard_branch_details_view === 'side_panel' ? 'side_panel' : 'modal'
  })
  const [busy, setBusy] = useState(false)

  const saveDashboard = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const next = await getApi().settings.save(dashboard)
      onSaved(next)
      setGlobalSettings(next)
      toast.success('Dashboard display settings saved')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="p-3 pb-1.5">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-[rgb(var(--primary)/.14)] p-2 text-[rgb(var(--primary))]">
            <LayoutDashboard size={16} />
          </div>
          <div>
            <CardTitle className="text-sm">Dashboard branch experience</CardTitle>
            <CardDescription className="mt-0.5 text-[11px] leading-snug">
              Choose when branch cards become compact and how their complete equipment view opens. Changes apply to the Dashboard page.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1.5">
        <form onSubmit={saveDashboard} className="space-y-2.5">
          <div className="grid gap-2.5 xl:grid-cols-2">
            <fieldset className="flex min-w-0 flex-col">
              <legend className="field-label">Branch card density</legend>
              {/* auto-rows-fr + h-full make all four option cards the same
                  height regardless of how long their descriptions wrap. */}
              <div className="grid flex-1 auto-rows-fr gap-2 sm:grid-cols-2">
                {branchModes.map((option) => (
                  <Choice key={option.value} {...option} selected={dashboard.dashboard_branch_mode === option.value} onClick={() => setDashboard({ ...dashboard, dashboard_branch_mode: option.value })} />
                ))}
              </div>
            </fieldset>
            <fieldset className="flex min-w-0 flex-col">
              <legend className="field-label">Equipment view style</legend>
              <div className="grid flex-1 auto-rows-fr gap-2 sm:grid-cols-2">
                {detailViews.map((option) => (
                  <Choice key={option.value} {...option} selected={dashboard.dashboard_branch_details_view === option.value} onClick={() => setDashboard({ ...dashboard, dashboard_branch_details_view: option.value })} />
                ))}
              </div>
            </fieldset>
          </div>
          <Button disabled={busy}><Save size={14} />{busy ? 'Saving…' : 'Save Dashboard experience'}</Button>
        </form>
      </CardContent>
    </Card>
  )
}
