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
}

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
      const res = await fetch(`/api/modal/deploy/${pluginId}`)
      if (!res.ok) throw new Error('Failed to fetch Modal deploy status')
      return res.json()
    },
    enabled: !!pluginId && visible,
    refetchInterval: pluginId && visible ? 30_000 : false,
    staleTime: 10_000,
  })
}
