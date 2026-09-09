import { create } from 'zustand'

export const useDevicesStore = create((set) => ({
  branches: [],
  devices: [],
  generatedAt: null,
  setSnapshot: ({ branches, devices, generated_at }) => set({ branches, devices, generatedAt: generated_at })
}))
