import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@/lib/constants'

export const useSettingsStore = create((set) => ({
  settings: DEFAULT_SETTINGS,
  ready: false,
  setSettings: (settings) => set({ settings: { ...DEFAULT_SETTINGS, ...settings }, ready: true })
}))
