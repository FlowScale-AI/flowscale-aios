'use client'

import { useState, useEffect } from 'react'
import { Cloud, Spinner, X, Warning } from 'phosphor-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useModalComfyInstances } from '@/hooks/useModalComfyInstances'
import type { ModalComfyInstanceData } from '@/hooks/useModalComfyInstances'

const TAG = '[ModalComfySection]'

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

function generateInstanceName(gpu: string, existing: ModalComfyInstanceData[]): string {
  const prefix = `comfyui-${gpu.toLowerCase()}`
  let n = 1
  while (existing.some((i) => i.id === `${prefix}-${n}` || i.name === `${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

export function ModalComfySection() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useModalComfyInstances()

  const instances = data?.instances ?? []
  const isAnyDeploying = instances.some((i) => i.status === 'deploying')

  // Deploy popup state
  const [showDeployPopup, setShowDeployPopup] = useState(false)
  const [popupGpu, setPopupGpu] = useState('A10')
  const [popupName, setPopupName] = useState(() => generateInstanceName('A10', []))

  // Optimistic pending instances
  const [pendingInstances, setPendingInstances] = useState<ModalComfyInstanceData[]>([])
  const allInstances = [
    ...instances,
    ...pendingInstances.filter((p) => !instances.some((i) => i.id === p.id)),
  ]

  // Undeploy confirmation state
  const [confirmUndeployId, setConfirmUndeployId] = useState<string | null>(null)
  // Track which instance IDs are being undeployed
  const [undeployingIds, setUndeployingIds] = useState<Set<string>>(new Set())

  // Log when query data changes
  useEffect(() => {
    console.log(TAG, 'query data updated — server instances:', instances.map(i => `${i.id}(${i.status})`))
    console.log(TAG, 'pendingInstances:', pendingInstances.map(i => `${i.id}(${i.status})`))
    console.log(TAG, 'allInstances (merged):', allInstances.map(i => `${i.id}(${i.status})`))
    console.log(TAG, 'undeployingIds:', [...undeployingIds])
    console.log(TAG, 'confirmUndeployId:', confirmUndeployId)
  }, [data, pendingInstances.length, undeployingIds.size, confirmUndeployId])

  const deployMutation = useMutation({
    mutationFn: async ({ gpu, name }: { gpu: string; name: string }) => {
      console.log(TAG, `DEPLOY — calling API: name="${name}" gpu="${gpu}"`)
      const res = await fetch('/api/modal/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy', gpu, name }),
      })
      console.log(TAG, `DEPLOY — API responded: status=${res.status}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Deploy failed' }))
        console.error(TAG, `DEPLOY — API error:`, err)
        throw new Error(err.error)
      }
      const json = await res.json()
      console.log(TAG, `DEPLOY — API success:`, json)
      return json
    },
    onSuccess: (_data, variables) => {
      console.log(TAG, `DEPLOY onSuccess — adding to pendingInstances: name="${variables.name}"`)
      setPendingInstances((prev) => [
        ...prev,
        {
          id: variables.name,
          name: variables.name,
          status: 'deploying' as const,
          gpu: variables.gpu,
          virtualPort: 0,
          url: '',
        },
      ])
      setShowDeployPopup(false)
      queryClient.invalidateQueries({ queryKey: ['modal-comfyui-instances'] })
    },
    onError: (err) => {
      console.error(TAG, `DEPLOY onError:`, err)
    },
  })

  const undeployMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      console.log(TAG, `UNDEPLOY — starting for instanceId="${instanceId}"`)
      console.log(TAG, `UNDEPLOY — current state: undeployingIds=[${[...undeployingIds]}], pendingInstances=[${pendingInstances.map(p => p.id)}]`)
      setUndeployingIds((prev) => new Set(prev).add(instanceId))
      console.log(TAG, `UNDEPLOY — calling API...`)
      const res = await fetch('/api/modal/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undeploy', instanceId }),
      })
      console.log(TAG, `UNDEPLOY — API responded: status=${res.status}, ok=${res.ok}`)
      if (!res.ok) {
        const body = await res.text()
        console.error(TAG, `UNDEPLOY — API error: status=${res.status}, body="${body}"`)
        throw new Error(`Undeploy failed (${res.status}): ${body}`)
      }
      const json = await res.json()
      console.log(TAG, `UNDEPLOY — API success:`, json)
      return json
    },
    onSuccess: (_data, instanceId) => {
      console.log(TAG, `UNDEPLOY onSuccess — instanceId="${instanceId}", cleaning up state`)
      setUndeployingIds((prev) => {
        const s = new Set(prev)
        s.delete(instanceId)
        return s
      })
      setPendingInstances((prev) => {
        const next = prev.filter((p) => p.id !== instanceId)
        console.log(TAG, `UNDEPLOY onSuccess — pendingInstances: [${prev.map(p => p.id)}] → [${next.map(p => p.id)}]`)
        return next
      })
      setConfirmUndeployId(null)
      console.log(TAG, `UNDEPLOY onSuccess — invalidating query cache`)
      queryClient.invalidateQueries({ queryKey: ['modal-comfyui-instances'] })
    },
    onError: (err, instanceId) => {
      console.error(TAG, `UNDEPLOY onError — instanceId="${instanceId}", error:`, err)
      setUndeployingIds((prev) => {
        const s = new Set(prev)
        s.delete(instanceId)
        return s
      })
    },
  })

  const resyncMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      console.log(TAG, `RESYNC — calling API for instanceId="${instanceId}"`)
      const res = await fetch('/api/modal/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resync', instanceId }),
      })
      console.log(TAG, `RESYNC — API responded: status=${res.status}`)
      if (!res.ok) throw new Error('Resync failed')
      return res.json()
    },
    onSuccess: () => {
      console.log(TAG, `RESYNC onSuccess — invalidating query cache`)
      queryClient.invalidateQueries({ queryKey: ['modal-comfyui-instances'] })
    },
    onError: (err) => {
      console.error(TAG, `RESYNC onError:`, err)
    },
  })

  function handleOpenDeployPopup() {
    const name = generateInstanceName(popupGpu, instances)
    console.log(TAG, `opening deploy popup, auto-name="${name}"`)
    setPopupName(name)
    setShowDeployPopup(true)
  }

  function handlePopupGpuChange(gpu: string) {
    setPopupGpu(gpu)
    setPopupName(generateInstanceName(gpu, instances))
  }

  return (
    <div className="mt-4 p-5 rounded-xl border border-purple-900/30 bg-purple-950/10 relative">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <Cloud size={16} weight="duotone" className="text-purple-400" />
        <span className="text-sm font-semibold text-purple-200 font-tech">
          Cloud Instances (Modal)
        </span>
        {!isLoading && (
          <span className="text-xs text-purple-400/60 font-mono">
            {allInstances.length} instance{allInstances.length !== 1 ? 's' : ''}
          </span>
        )}
        {isAnyDeploying && (
          <span className="flex items-center gap-1 text-purple-400 text-xs">
            <Spinner size={12} className="animate-spin" />
            Deploying...
          </span>
        )}
        <button
          onClick={handleOpenDeployPopup}
          disabled={isAnyDeploying || deployMutation.isPending}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          + Deploy Instance
        </button>
      </div>

      {/* Instance list */}
      {allInstances.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {allInstances.map((inst) => {
            const isStopping = undeployingIds.has(inst.id)
            return (
              <div
                key={inst.id}
                className={`flex items-center gap-2 py-2 px-3 bg-purple-950/30 rounded-lg border border-purple-900/20 ${isStopping ? 'opacity-50' : ''}`}
              >
                {/* Status indicator */}
                {(inst.status === 'deploying' || isStopping) ? (
                  <Spinner size={12} className="animate-spin text-purple-400 shrink-0" />
                ) : inst.status === 'error' ? (
                  <Warning size={12} weight="fill" className="text-red-400 shrink-0" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                )}

                {/* Name */}
                <span className="text-purple-100 text-xs truncate flex-1 font-medium">
                  {inst.name}
                  {isStopping && <span className="text-red-400 ml-1.5">Stopping...</span>}
                  {inst.status === 'error' && inst.errorMessage && (
                    <span className="text-red-400 ml-1.5 font-normal">{inst.errorMessage}</span>
                  )}
                </span>

                {/* Virtual port */}
                {inst.virtualPort > 0 && (
                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                    :{inst.virtualPort}
                  </span>
                )}

                {/* GPU badge */}
                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400 rounded shrink-0">
                  {inst.gpu}
                </span>

                {/* Status badge */}
                {!isStopping && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${
                      inst.status === 'deployed'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : inst.status === 'deploying'
                        ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}
                  >
                    {inst.status}
                  </span>
                )}

                {/* Sync & Redeploy button */}
                {inst.status === 'deployed' && (
                  <button
                    onClick={() => resyncMutation.mutate(inst.id)}
                    disabled={resyncMutation.isPending || isStopping}
                    className="text-[10px] px-1.5 py-0.5 rounded text-purple-400 hover:text-purple-300 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 disabled:opacity-40 transition-colors shrink-0"
                    title="Re-scan local custom nodes & models, rebuild and redeploy"
                  >
                    {resyncMutation.isPending ? 'Syncing...' : 'Sync'}
                  </button>
                )}

                {/* Undeploy button */}
                <button
                  onClick={() => {
                    console.log(TAG, `X button clicked — opening confirm dialog for "${inst.id}"`)
                    setConfirmUndeployId(inst.id)
                  }}
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

      {/* Empty state */}
      {!isLoading && allInstances.length === 0 && (
        <p className="text-xs text-zinc-600 mt-1">
          No cloud instances deployed. Deploy one to run ComfyUI on Modal.
        </p>
      )}

      {/* Deploy popup */}
      {showDeployPopup && (
        <div className="absolute right-5 top-12 z-50 w-72 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-4 flex flex-col gap-3">
          <p className="text-zinc-200 text-sm font-medium font-tech">New Cloud Instance</p>

          {/* Name input */}
          <div className="flex flex-col gap-1">
            <label className="text-zinc-400 text-xs">Name</label>
            <input
              type="text"
              value={popupName}
              onChange={(e) => setPopupName(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 focus:border-purple-500/50 rounded-lg text-zinc-200 outline-none transition-colors"
            />
          </div>

          {/* GPU selector */}
          <div className="flex flex-col gap-1">
            <label className="text-zinc-400 text-xs">GPU</label>
            <select
              value={popupGpu}
              onChange={(e) => handlePopupGpuChange(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 focus:border-purple-500/50 rounded-lg text-zinc-200 outline-none transition-colors"
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
              onClick={() => setShowDeployPopup(false)}
              disabled={deployMutation.isPending}
              className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => deployMutation.mutate({ gpu: popupGpu, name: popupName })}
              disabled={deployMutation.isPending || !popupName.trim()}
              className="px-3 py-1 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {deployMutation.isPending ? 'Deploying...' : 'Deploy'}
            </button>
          </div>
        </div>
      )}

      {/* Undeploy confirmation popup */}
      {confirmUndeployId && (
        <div className="absolute right-5 top-12 z-50 w-72 bg-zinc-900 border border-red-500/20 rounded-xl shadow-2xl p-4 flex flex-col gap-3">
          <p className="text-zinc-200 text-sm font-medium">Undeploy {confirmUndeployId}?</p>
          <p className="text-zinc-500 text-xs">
            This will stop and delete the Modal app. You can redeploy later.
          </p>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => {
                console.log(TAG, `confirm dialog — Cancel clicked`)
                setConfirmUndeployId(null)
              }}
              disabled={undeployMutation.isPending}
              className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                console.log(TAG, `confirm dialog — Undeploy clicked for "${confirmUndeployId}"`)
                undeployMutation.mutate(confirmUndeployId)
              }}
              disabled={undeployMutation.isPending}
              className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {undeployMutation.isPending ? 'Stopping...' : 'Undeploy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
