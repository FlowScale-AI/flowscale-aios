'use client'

import { useState } from 'react'
import { Cloud, Spinner, X, Warning, CaretDown, CaretUp } from 'phosphor-react'
import { useMutation, useQuery } from '@tanstack/react-query'

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
  status: 'deploying' | 'deployed' | 'failed'
  gpu: string
  warm: boolean | null
  url: string
  error?: string
}

interface MissingSecretsError {
  message: string
  missingSecrets: string[]
}

interface ModalDeployBannerProps {
  pluginId: string
  defaultGpu: string
  requiredSecrets?: string[]
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
  requiredSecrets,
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

  // Merge server deployments with optimistic pending ones.
  // Drop pending entries that: (a) the server now has, or (b) are older than 15s
  // without the server confirming them (deploy failed/cleaned up server-side).
  const now = Date.now()
  const activePending = pendingDeploys.filter(p => {
    if (deployments.some(d => d.id === p.id)) return false
    const age = now - ((p as unknown as Record<string, unknown>)._createdAt as number || 0)
    return age < 15_000
  })
  if (activePending.length !== pendingDeploys.length) {
    setTimeout(() => setPendingDeploys(activePending), 0)
  }
  const allDeployments = [...deployments, ...activePending]
  const isAnyDeploying = allDeployments.some((d) => d.status === 'deploying')
  const hasFailedOrDeploying = allDeployments.some((d) => d.status === 'deploying' || d.status === 'failed')
  const [showLogs, setShowLogs] = useState(false)
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set())

  // Poll deploy logs when actively deploying or viewing logs
  const { data: logData } = useQuery<{ logs: string }>({
    queryKey: ['modal-deploy-logs', pluginId],
    queryFn: async () => {
      const res = await fetch(`/api/modal/deploy/${pluginId}?health=false&logs=true`)
      if (!res.ok) return { logs: '' }
      const data = await res.json()
      return { logs: data.logs ?? '' }
    },
    enabled: showLogs || isAnyDeploying,
    refetchInterval: isAnyDeploying ? 3_000 : false,
    staleTime: 2_000,
  })

  const toggleError = (id: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const deployMutation = useMutation({
    mutationFn: async ({ gpu, name }: { gpu: string; name: string }) => {
      const res = await fetch(`/api/modal/deploy/${pluginId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy', gpu, name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Deploy failed' }))
        const error = new Error(err.error) as Error & { missingSecrets?: string[] }
        if (err.missingSecrets) error.missingSecrets = err.missingSecrets
        throw error
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
        _createdAt: Date.now(),
      } as ModalDeploymentStatus & { _createdAt: number }])
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
            const isFailed = deployment.status === 'failed'
            const isErrorExpanded = expandedErrors.has(deployment.id)
            return (
            <div key={deployment.id} className="flex flex-col">
              <div
                className={`flex items-center gap-2 py-1 px-2 rounded border ${
                  isFailed
                    ? 'bg-red-950/30 border-red-500/20'
                    : 'bg-purple-950/30 border-purple-900/20'
                } ${isStopping ? 'opacity-50' : ''}`}
              >
                {/* Status indicator */}
                {(deployment.status === 'deploying' || isStopping) && (
                  <Spinner size={12} className="animate-spin text-purple-400 shrink-0" />
                )}
                {isFailed && (
                  <Warning size={12} className="text-red-400 shrink-0" />
                )}
                <span className={`text-xs truncate flex-1 ${isFailed ? 'text-red-300' : 'text-purple-200'}`}>
                  {deployment.name}
                  {isStopping && <span className="text-red-400 ml-1">Stopping...</span>}
                  {isFailed && <span className="text-red-400 ml-1">Failed</span>}
                </span>

                {/* GPU badge */}
                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400 rounded shrink-0">
                  {deployment.gpu}
                </span>

                {/* Warm/Cold indicator */}
                {deployment.status === 'deployed' && deployment.warm !== null && (
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

                {/* Error expand toggle */}
                {isFailed && deployment.error && (
                  <button
                    onClick={() => toggleError(deployment.id)}
                    className="text-red-400 hover:text-red-300 transition-colors shrink-0"
                    title="Show error details"
                  >
                    {isErrorExpanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
                  </button>
                )}

                {/* Undeploy / Dismiss button */}
                <button
                  onClick={() => handleUndeploy(deployment.id)}
                  disabled={isStopping}
                  className="ml-1 text-zinc-600 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  title={isFailed ? 'Dismiss' : 'Undeploy'}
                >
                  <X size={12} />
                </button>
              </div>

              {/* Error details */}
              {isFailed && isErrorExpanded && deployment.error && (
                <div className="mt-1 px-2 py-1.5 bg-red-950/20 border border-red-500/10 rounded text-[11px] font-mono text-red-300/80 max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                  {deployment.error}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {/* Deploy logs toggle + panel */}
      {hasFailedOrDeploying && (
        <button
          onClick={() => setShowLogs((v) => !v)}
          className="mt-2 flex items-center gap-1 text-[11px] text-purple-400/70 hover:text-purple-300 transition-colors"
        >
          {showLogs ? <CaretUp size={10} /> : <CaretDown size={10} />}
          {showLogs ? 'Hide deploy logs' : 'View deploy logs'}
        </button>
      )}
      {showLogs && (
        <div className="mt-1.5 rounded border border-purple-900/30 bg-black/30 overflow-hidden">
          <pre className="px-3 py-2 text-[11px] font-mono text-zinc-400 max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
            {logData?.logs || 'No logs available yet...'}
          </pre>
        </div>
      )}

      {/* Deploy popup */}
      {showPopup && (
        <div className="absolute right-6 top-full mt-2 z-50 w-72 bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-4 flex flex-col gap-3">
          <p className="text-zinc-200 text-sm font-medium font-tech">New Modal Deployment</p>

          {/* Required secrets warning */}
          {requiredSecrets && requiredSecrets.length > 0 && (
            <div className="bg-amber-950/30 border border-amber-500/20 rounded p-2.5 flex flex-col gap-1">
              <p className="text-amber-400 text-xs font-medium">Requires Modal Secrets</p>
              <p className="text-amber-400/70 text-xs">This model is gated. Ensure these secrets exist in your Modal dashboard before deploying:</p>
              {requiredSecrets.map((s) => (
                <a
                  key={s}
                  href={`https://modal.com/secrets/create?secret_name=${s}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 text-xs underline underline-offset-2"
                >
                  {s} →
                </a>
              ))}
            </div>
          )}

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

          {deployMutation.error && (() => {
            const err = deployMutation.error as Error & { missingSecrets?: string[] }
            const secrets = err.missingSecrets
            if (secrets?.length) {
              return (
                <div className="bg-red-950/40 border border-red-500/20 rounded p-2.5 flex flex-col gap-1.5">
                  <p className="text-red-400 text-xs font-medium">Missing Modal Secrets</p>
                  <p className="text-red-400/80 text-xs">This model is gated and requires authentication. Create the following secrets in your Modal dashboard:</p>
                  {secrets.map((s) => (
                    <a
                      key={s}
                      href={`https://modal.com/secrets/create?secret_name=${s}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-400 hover:text-purple-300 text-xs underline underline-offset-2"
                    >
                      Create &quot;{s}&quot; secret →
                    </a>
                  ))}
                </div>
              )
            }
            return <p className="text-red-400 text-xs">{err.message}</p>
          })()}

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
