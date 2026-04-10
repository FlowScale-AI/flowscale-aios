'use client'
import { useQuery } from '@tanstack/react-query'

export interface ModalComfyInstanceData {
  id: string
  name: string
  status: 'deploying' | 'deployed' | 'error'
  errorMessage?: string
  gpu: string
  virtualPort: number
  url: string
}

export function useModalComfyInstances() {
  return useQuery<{ instances: ModalComfyInstanceData[] }>({
    queryKey: ['modal-comfyui-instances'],
    queryFn: async () => {
      const res = await fetch('/api/modal/comfyui')
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
    refetchInterval: (query) => {
      const instances = query.state.data?.instances ?? []
      return instances.some(i => i.status === 'deploying') ? 5_000 : 60_000
    },
  })
}
