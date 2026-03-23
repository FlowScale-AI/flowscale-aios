'use client'

import { useState } from 'react'
import { Cloud, Spinner, X } from 'phosphor-react'
import { useMutation } from '@tanstack/react-query'

const GPU_OPTIONS = [
  { value: 'T4', label: 'T4 (16 GB)' },
  { value: 'L4', label: 'L4 (24 GB)' },
  { value: 'A10', label: 'A10 (24 GB)' },
  { value: 'L40S', label: 'L40S (48 GB)' },
  { value: 'A100-40GB', label: 'A100 40 GB' },
  { value: 'A100-80GB', label: 'A100 80 GB' },
  { value: 'RTX-PRO-6000', label: 'RTX PRO 6000 (48 GB)' },
  { value: 'H100', label: 'H100 (80 GB)' },
  { value: 'H200', label: 'H200 (141 GB)' },
  { value: 'B200', label: 'B200 (192 GB)' },
] as const

interface ModalDeploymentStatus {
  id: string
  name: string
  status: 'deploying' | 'deployed'
  gpu: string
  warm: boolean | null
  url: string
}

interface ModalDeployBannerProps {
  pluginId: string
  defaultGpu: string
  deployments: ModalDeploymentStatus[]
  onDeployed?: () => void
}

function generateDeployName(
  pluginId: string,
  gpu: string,
  existing: ModalDeploymentStatus[],
): string {
  const prefix = `${pluginId}-${gpu.toLowerCase()}`
  let n = 1
  while (existing.some((d) => d.id === `${prefix}-${n}` || d.name === `${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

export function ModalDeployBanner({
  pluginId,
  defaultGpu,
  deployments,
  onDeployed,
}: ModalDeployBannerProps) {
  const [showPopup, setShowPopup] = useState(false)
  const [popupGpu, setPopupGpu] = useState(defaultGpu || 'A10')
  const [popupName, setPopupName] = useState(() =>
    generateDeployName(pluginId, defaultGpu || 'A10', deployments),
  )
  // Optimistic: track deploys we've kicked off that may not be in the poll yet
  const [pendingDeploys, setPendingDeploys] = useState<ModalDeploymentStatus[]>([])
  // Track which deployment IDs are being undeployed (for UI feedback)
  const [undployingIds, setUndeployingIds] = useState<Set<string>>(new Set())

  // Merge server deployments with optimistic pending ones (remove pending once server has it)
  const allDeployments = [
    ...deployments,
    ...pendingDeploys.filter(p => !deployments.some(d => d.id === p.id)),
  ]
  const isAnyDeploying = allDeployments.some((d) => d.status === 'deploying')

  const deployMutation = useMutation({
    mutationFn: async ({ gpu, name }: { gpu: string; name: string }) => {
      const res = await fetch(`/api/modal/deploy/${pluginId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy', gpu, name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Deploy failed' }))
        throw new Error(err.error)
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      // Optimistically add the deploying entry so it shows immediately
      setPendingDeploys(prev => [...prev, {
        id: variables.name,
        name: variables.name,
        status: 'deploying' as const,
        gpu: variables.gpu,
        warm: null,
        url: '',
      }])
      setShowPopup(false)
      onDeployed?.()
    },
  })

  // Undeploy confirmation state
  const [confirmUndeployId, setConfirmUndeployId] = useState<string | null>(null)

  const undeployMutation = useMutation({
    mutationFn: async (deployId: string) => {
      setUndeployingIds(prev => new Set(prev).add(deployId))
      const res = await fetch(`/api/modal/deploy/${pluginId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undeploy', deployId }),
      })
      if (!res.ok) throw new Error('Undeploy failed')
      return res.json()
    },
    onSuccess: (_data, deployId) => {
      setUndeployingIds(prev => { const s = new Set(prev); s.delete(deployId); return s })
      setConfirmUndeployId(null)
      onDeployed?.()
    },
    onError: (_err, deployId) => {
      setUndeployingIds(prev => { const s = new Set(prev); s.delete(deployId); return s })
    },
  })

  function handleUndeploy(deployId: string) {
    setConfirmUndeployId(deployId)
  }

  function handleOpenPopup() {
    const gpu = defaultGpu || 'A10'
    const name = generateDeployName(pluginId, gpu, deployments)
    setPopupGpu(gpu)
    setPopupName(name)
    setShowPopup(true)
  }

  function handlePopupGpuChange(gpu: string) {
    setPopupGpu(gpu)
    setPopupName(generateDeployName(pluginId, gpu, deployments))
  }

  return (
    <div className="px-6 py-2.5 bg-purple-950/20 border-b border-purple-900/30 text-sm relative">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <Cloud size={16} weight="duotone" className="text-purple-400" />
        <span className="text-purple-300 font-medium">Modal Cloud</span>
        <span className="text-purple-400/60 text-xs">
          {allDeployments.length} deployment{allDeployments.length !== 1 ? 's' : ''}
        </span>
        {isAnyDeploying && (
          <span className="flex items-center gap-1 text-purple-400 text-xs">
            <Spinner size={12} className="animate-spin" />
            Deploying...
          </span>
        )}
        <button
          onClick={handleOpenPopup}
          disabled={isAnyDeploying}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
        >
          + Deploy
        </button>
      </div>

      {/* Deployment list */}
      {allDeployments.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {allDeployments.map((deployment) => {
            const isStopping = undployingIds.has(deployment.id)
            return (
            <div
              key={deployment.id}
              className={`flex items-center gap-2 py-1 px-2 bg-purple-950/30 rounded border border-purple-900/20 ${isStopping ? 'opacity-50' : ''}`}
            >
              {/* Status spinner */}
              {(deployment.status === 'deploying' || isStopping) && (
                <Spinner size={12} className="animate-spin text-purple-400 shrink-0" />
              )}
              <span className="text-purple-200 text-xs truncate flex-1">
                {deployment.name}
                {isStopping && <span className="text-red-400 ml-1">Stopping...</span>}
              </span>

              {/* GPU badge */}
              <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400 rounded shrink-0">
                {deployment.gpu}
              </span>

              {/* Warm/Cold indicator */}
              {deployment.warm !== null && (
                <span
                  className={`flex items-center gap-1 text-xs shrink-0 ${
                    deployment.warm ? 'text-emerald-400' : 'text-zinc-500'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      deployment.warm ? 'bg-emerald-400' : 'bg-zinc-600'
                    }`}
                  />
                  {deployment.warm ? 'Warm' : 'Cold'}
                </span>
              )}

              {/* Undeploy button */}
              <button
                onClick={() => handleUndeploy(deployment.id)}
                disabled={isStopping}
                className="ml-1 text-zinc-600 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                title="Undeploy"
              >
                <X size={12} />
              </button>
            </div>
            )
          })}
        </div>
      )}

      {/* Deploy popup */}
      {showPopup && (
        <div className="absolute right-6 top-full mt-2 z-50 w-72 bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-4 flex flex-col gap-3">
          <p className="text-zinc-200 text-sm font-medium font-tech">New Modal Deployment</p>

          {/* Name input */}
          <div className="flex flex-col gap-1">
            <label className="text-zinc-400 text-xs">Name</label>
            <input
              type="text"
              value={popupName}
              onChange={(e) => setPopupName(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 focus:border-purple-500/50 rounded text-zinc-200 outline-none transition-colors"
            />
          </div>

          {/* GPU selector */}
          <div className="flex flex-col gap-1">
            <label className="text-zinc-400 text-xs">GPU</label>
            <select
              value={popupGpu}
              onChange={(e) => handlePopupGpuChange(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 focus:border-purple-500/50 rounded text-zinc-200 outline-none transition-colors"
            >
              {GPU_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {deployMutation.error && (
            <p className="text-red-400 text-xs">{(deployMutation.error as Error).message}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setShowPopup(false)}
              disabled={deployMutation.isPending}
              className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => deployMutation.mutate({ gpu: popupGpu, name: popupName })}
              disabled={deployMutation.isPending || !popupName.trim()}
              className="px-3 py-1 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
            >
              {deployMutation.isPending ? 'Deploying...' : 'Deploy'}
            </button>
          </div>
        </div>
      )}

      {/* Undeploy confirmation popup */}
      {confirmUndeployId && (
        <div className="absolute right-6 top-full mt-2 z-50 w-72 bg-zinc-900 border border-red-500/20 rounded-lg shadow-xl p-4 flex flex-col gap-3">
          <p className="text-zinc-200 text-sm font-medium">Undeploy {confirmUndeployId}?</p>
          <p className="text-zinc-500 text-xs">This will stop and delete the Modal app. You can redeploy later.</p>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setConfirmUndeployId(null)}
              disabled={undeployMutation.isPending}
              className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => undeployMutation.mutate(confirmUndeployId)}
              disabled={undeployMutation.isPending}
              className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded transition-colors"
            >
              {undeployMutation.isPending ? 'Stopping...' : 'Undeploy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
