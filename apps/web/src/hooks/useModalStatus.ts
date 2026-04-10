'use client'

import { useQuery } from '@tanstack/react-query'

export interface ModalStatus {
  installed: boolean
  authenticated: boolean
  workspace?: string
  authInProgress?: boolean
}

export function useModalStatus(pollingEnabled = false) {
  return useQuery<ModalStatus>({
    queryKey: ['modal-status'],
    queryFn: async () => {
      const res = await fetch('/api/modal/status')
      if (!res.ok) return { installed: false, authenticated: false }
      return res.json()
    },
    refetchInterval: pollingEnabled ? 3000 : false,
    staleTime: 30_000,
  })
}
