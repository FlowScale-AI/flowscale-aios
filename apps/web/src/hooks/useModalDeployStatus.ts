'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

export interface ModalDeployStatusData {
  status: 'not_deployed' | 'deploying' | 'deployed'
  warm: boolean
  gpu: string | null
  url: string | null
  supported?: boolean
  defaultGpu?: string
  logs?: string
}

/**
 * Lightweight status poll — skips log fetching to avoid spawning
 * a subprocess on every poll. Used for the Modal button visibility
 * and deploy banner state.
 */
export function useModalDeployStatus(pluginId: string | null) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const handler = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return useQuery<ModalDeployStatusData>({
    queryKey: ['modal-deploy-status', pluginId],
    queryFn: async () => {
      // Skip logs on status polls — they're expensive (subprocess + 3s timeout)
      const res = await fetch(`/api/modal/deploy/${pluginId}?logs=false`)
      if (!res.ok) throw new Error('Failed to fetch Modal deploy status')
      return res.json()
    },
    enabled: !!pluginId && visible,
    refetchInterval: pluginId && visible ? (query) => {
      const status = query.state.data?.status
      // Poll faster during deploy, slower when stable
      return status === 'deploying' ? 5_000 : 60_000
    } : false,
    staleTime: 10_000,
  })
}

/**
 * Fetches Modal logs (deploy + runtime). Only enable when the user
 * is actively viewing the Logs tab with Modal selected.
 */
export function useModalLogs(pluginId: string | null, enabled: boolean) {
  return useQuery<{ logs: string }>({
    queryKey: ['modal-logs', pluginId],
    queryFn: async () => {
      const res = await fetch(`/api/modal/deploy/${pluginId}`)
      if (!res.ok) throw new Error('Failed to fetch Modal logs')
      const data = await res.json()
      return { logs: data.logs ?? '' }
    },
    enabled: !!pluginId && enabled,
    refetchInterval: enabled ? 10_000 : false,
    staleTime: 5_000,
  })
}
