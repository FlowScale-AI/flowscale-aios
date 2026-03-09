import { create } from 'zustand'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'up-to-date'

interface UpdateState {
  status: UpdateStatus
  version: string | null
  progress: number | null
  error: string | null
  setChecking: () => void
  setAvailable: (version: string) => void
  setNotAvailable: () => void
  setProgress: (percent: number) => void
  setDownloaded: (version: string) => void
  setError: (message: string) => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: 'idle',
  version: null,
  progress: null,
  error: null,
  setChecking: () => set({ status: 'checking', error: null }),
  setAvailable: (version) => set({ status: 'available', version }),
  setNotAvailable: () => set({ status: 'up-to-date' }),
  setProgress: (percent) => set({ status: 'downloading', progress: percent }),
  setDownloaded: (version) => set({ status: 'downloaded', version, progress: null }),
  setError: (message) => set({ status: 'error', error: message, progress: null }),
}))
