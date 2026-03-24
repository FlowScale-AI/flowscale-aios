'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

export interface ModalDeploymentStatus {
  id: string
  name: string
  status: 'deploying' | 'deployed'
  gpu: string
  warm: boolean | null
  url: string
}

export interface ModalDeployStatusData {
  supported: boolean
  defaultGpu: string
  requiredSecrets?: string[]
  deployments: ModalDeploymentStatus[]
  logs?: string
}

/**
 * Lightweight status poll — skips log fetching to avoid spawning
 * a subprocess on every poll. Used for the Modal button visibility
 * and deploy banner state.
 */
export function useModalDeployStatus(pluginId: string | null, selectedTarget?: string) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const handler = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return useQuery<ModalDeployStatusData>({
    queryKey: ['modal-deploy-status', pluginId, selectedTarget],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('logs', 'false')
      // Never auto health-check — it keeps Modal containers warm and wastes credits.
      // Warm/cold is unknown until user runs inference.
      params.set('health', 'false')
      if (selectedTarget && selectedTarget !== '') params.set('target', selectedTarget)
      const res = await fetch(`/api/modal/deploy/${pluginId}?${params}`)
      if (!res.ok) throw new Error('Failed to fetch Modal deploy status')
      return res.json()
    },
    enabled: !!pluginId && visible,
    refetchInterval: pluginId && visible ? (query) => {
      const deployments = query.state.data?.deployments ?? []
      return deployments.some(d => d.status === 'deploying') ? 5_000 : 60_000
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
