import { create } from 'zustand'

export const useVpnStore = create((set) => ({
  state: 'disconnected',
  mode: null,
  message: '',
  setStatus: (status) => set(status)
}))
