'use client'

import { useState } from 'react'
import { Cloud, CaretDown, Spinner, X } from 'phosphor-react'
import { useModalDeployStatus } from '@/hooks/useModalDeployStatus'
import { useMutation, useQueryClient } from '@tanstack/react-query'

const GPU_OPTIONS = [
  { value: 'T4', label: 'T4 (16 GB)' },
  { value: 'A10G', label: 'A10G (24 GB)' },
  { value: 'L4', label: 'L4 (24 GB)' },
  { value: 'A100', label: 'A100 (80 GB)' },
  { value: 'H100', label: 'H100 (80 GB)' },
] as const

interface ModalDeployBannerProps {
  pluginId: string
  defaultGpu: string
}

export function ModalDeployBanner({ pluginId, defaultGpu }: ModalDeployBannerProps) {
  const queryClient = useQueryClient()
  const { data: status, isLoading } = useModalDeployStatus(pluginId)
  const [selectedGpu, setSelectedGpu] = useState(defaultGpu || 'A10G')
  const [gpuDropdownOpen, setGpuDropdownOpen] = useState(false)

  const deployMutation = useMutation({
    mutationFn: async (gpu: string) => {
      const res = await fetch(`/api/modal/deploy/${pluginId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy', gpu }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Deploy failed' }))
        throw new Error(err.error)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modal-deploy-status', pluginId] })
    },
  })

  const undeployMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/modal/deploy/${pluginId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undeploy' }),
      })
      if (!res.ok) throw new Error('Undeploy failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modal-deploy-status', pluginId] })
    },
  })

  if (isLoading || !status) {
    return (
      <div className="px-6 py-2.5 bg-purple-950/20 border-b border-purple-900/30 flex items-center gap-2 text-purple-300 text-sm">
        <Spinner size={14} className="animate-spin" />
        Checking Modal status...
      </div>
    )
  }

  // ── Not Deployed ──────────────────────────────────────────────────────────
  if (status.status === 'not_deployed') {
    return (
      <div className="px-6 py-2.5 bg-purple-950/20 border-b border-purple-900/30 flex items-center gap-2 text-sm">
        <Cloud size={16} weight="duotone" className="text-purple-400" />
        <span className="text-purple-300">Not deployed to Modal</span>
        <div className="ml-auto flex items-center gap-2">
          {/* GPU picker */}
          <div className="relative">
            <button
              onClick={() => setGpuDropdownOpen((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-300 hover:border-zinc-500"
            >
              {selectedGpu}
              <CaretDown size={10} className="opacity-50" />
            </button>
            {gpuDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-1 z-50 min-w-[140px]">
                {GPU_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSelectedGpu(opt.value); setGpuDropdownOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                      selectedGpu === opt.value
                        ? 'text-purple-400 bg-purple-500/10'
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => deployMutation.mutate(selectedGpu)}
            disabled={deployMutation.isPending}
            className="px-3 py-1 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded transition-colors"
          >
            {deployMutation.isPending ? 'Deploying...' : 'Deploy'}
          </button>
        </div>
        {deployMutation.error && (
          <span className="text-red-400 text-xs ml-2">{deployMutation.error.message}</span>
        )}
      </div>
    )
  }

  // ── Deploying ─────────────────────────────────────────────────────────────
  if (status.status === 'deploying') {
    return (
      <div className="px-6 py-2.5 bg-purple-950/20 border-b border-purple-900/30 flex items-center gap-2 text-sm">
        <Spinner size={14} className="animate-spin text-purple-400" />
        <span className="text-purple-300">Deploying to Modal...</span>
        <span className="text-purple-400/60 text-xs ml-1">This can take a few minutes (building image + downloading model)</span>
      </div>
    )
  }

  // ── Deployed ──────────────────────────────────────────────────────────────
  return (
    <div className="px-6 py-2.5 bg-purple-950/20 border-b border-purple-900/30 flex items-center gap-2 text-sm">
      <Cloud size={16} weight="duotone" className="text-purple-400" />
      <span className="text-purple-300">Modal Cloud</span>
      {/* Warm/Cold indicator */}
      <span className={`flex items-center gap-1 text-xs ${status.warm ? 'text-emerald-400' : 'text-zinc-500'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${status.warm ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        {status.warm ? 'Warm' : 'Cold'}
      </span>
      {/* GPU selector (redeploys on change) */}
      <div className="relative ml-2">
        <button
          onClick={() => setGpuDropdownOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-300 hover:border-zinc-500"
        >
          {status.gpu || selectedGpu}
          <CaretDown size={10} className="opacity-50" />
        </button>
        {gpuDropdownOpen && (
          <div className="absolute right-0 top-full mt-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-1 z-50 min-w-[140px]">
            {GPU_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setGpuDropdownOpen(false)
                  if (opt.value !== (status.gpu || selectedGpu)) {
                    setSelectedGpu(opt.value)
                    deployMutation.mutate(opt.value)
                  }
                }}
                className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                  (status.gpu || selectedGpu) === opt.value
                    ? 'text-purple-400 bg-purple-500/10'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Undeploy button */}
      <button
        onClick={() => undeployMutation.mutate()}
        disabled={undeployMutation.isPending}
        className="ml-auto flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-red-400 transition-colors"
      >
        <X size={12} />
        {undeployMutation.isPending ? 'Removing...' : 'Undeploy'}
      </button>
      {/* Cold start note */}
      {!status.warm && (
        <span className="text-zinc-600 text-[11px]">First request ~1-2 min</span>
      )}
    </div>
  )
}
