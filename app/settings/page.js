'use client'

import { useEffect, useState } from 'react'
import { SlidersHorizontal, KeyRound, Link2, MonitorCog, PlugZap, TerminalSquare, Shield, Palette, Type, LayoutDashboard, Store } from 'lucide-react'
import { toast } from 'sonner'
import AppShell from '@/components/layout/AppShell'
import GeneralSettings from '@/components/settings/GeneralSettings'
import StoreAppSettings from '@/components/settings/StoreAppSettings'
import CredentialsSettings from '@/components/settings/CredentialsSettings'
import AssignmentsSettings from '@/components/settings/AssignmentsSettings'
import ConnectionsSettings from '@/components/settings/ConnectionsSettings'
import DeviceSettings from '@/components/settings/DeviceSettings'
import TerminalSettings from '@/components/settings/TerminalSettings'
import VPNSettings from '@/components/settings/VPNSettings'
import ThemeSettings from '@/components/settings/ThemeSettings'
import TypographySettings from '@/components/settings/TypographySettings'
import DashboardSettings from '@/components/settings/DashboardSettings'
import { Card, Skeleton, Tabs, TabsContent } from '@/components/ui'
import { getApi } from '@/lib/api'
import { DEFAULT_SETTINGS } from '@/lib/constants'

const tabs = [
  { value: 'general', label: 'General', icon: <SlidersHorizontal size={14} /> },
  { value: 'store-app', label: 'Store App', icon: <Store size={14} /> },
  { value: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
  { value: 'credentials', label: 'Credentials', icon: <KeyRound size={14} /> },
  { value: 'assignments', label: 'Assignments', icon: <Link2 size={14} /> },
  { value: 'connections', label: 'Connections', icon: <PlugZap size={14} /> },
  { value: 'devices', label: 'Device tools', icon: <MonitorCog size={14} /> },
  { value: 'terminal', label: 'Terminal & web', icon: <TerminalSquare size={14} /> },
  { value: 'vpn', label: 'VPN', icon: <Shield size={14} /> },
  { value: 'theme', label: 'Theme', icon: <Palette size={14} /> },
  { value: 'typography', label: 'Fonts', icon: <Type size={14} /> }
]

export default function SettingsPage() {
  const [tab, setTab] = useState('general')
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    getApi().settings.get()
      .then((value) => setSettings({ ...DEFAULT_SETTINGS, ...value }))
      .catch((error) => toast.error(error.message))
  }, [])

  return (
    <AppShell>
      <div className="mx-auto max-w-[1600px] space-y-3">
        <div>
          <h1 className="page-title">Application settings</h1>
          <p className="page-subtitle">Security, monitoring, Store App deployment, the dashboard experience, credentials and their assignments, connection methods, device tools, terminal, VPN, and appearance.</p>
        </div>

        {!settings ? (
          <Skeleton className="h-[460px]" />
        ) : (
          /* The tab strip lives outside the panel so the active tab reads as a
             header for the card below it rather than a control inside it. */
          <Tabs value={tab} onValueChange={setTab} tabs={tabs} listClassName="mb-2.5 w-fit max-w-full">
            <Card className="p-3">
              <TabsContent value="general"><GeneralSettings settings={settings} onSaved={setSettings} /></TabsContent>
              <TabsContent value="store-app"><StoreAppSettings settings={settings} onSaved={setSettings} /></TabsContent>
              <TabsContent value="dashboard"><DashboardSettings settings={settings} onSaved={setSettings} /></TabsContent>
              <TabsContent value="credentials"><CredentialsSettings /></TabsContent>
              <TabsContent value="assignments"><AssignmentsSettings /></TabsContent>
              <TabsContent value="connections"><ConnectionsSettings settings={settings} onSaved={setSettings} /></TabsContent>
              <TabsContent value="devices"><DeviceSettings settings={settings} onSaved={setSettings} /></TabsContent>
              <TabsContent value="terminal"><TerminalSettings settings={settings} onSaved={setSettings} /></TabsContent>
              <TabsContent value="vpn"><VPNSettings settings={settings} onSaved={setSettings} /></TabsContent>
              <TabsContent value="theme"><ThemeSettings settings={settings} onSaved={setSettings} /></TabsContent>
              <TabsContent value="typography"><TypographySettings settings={settings} onSaved={setSettings} /></TabsContent>
            </Card>
          </Tabs>
        )}
      </div>
    </AppShell>
  )
}
