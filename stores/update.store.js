import { create } from 'zustand'

/**
 * The latest update check result, shared by the shell (which runs the
 * automatic check on launch) and the Notification Center (which announces the
 * update with its changelog). `dismissed` hides the bell card until the next
 * app launch or a newer version appears.
 */
export const useUpdateStore = create((set) => ({
  info: null,
  dismissed: false,
  setInfo: (info) => set((state) => ({
    info,
    // A different version than the dismissed one gets a fresh announcement.
    dismissed: state.dismissed && state.info?.latestVersion === info?.latestVersion
  })),
  dismiss: () => set({ dismissed: true })
}))
