'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Cloud, Desktop, Spinner, X, Warning, CaretDown, CaretUp, Shuffle, CheckCircle, WarningCircle, Stop, Play } from 'phosphor-react'
import { useMutation, useQuery } from '@tanstack/react-query'

// ── GPU tier options ────────────────────────────────────────────────────────
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

// ── Types ───────────────────────────────────────────────────────────────────

export interface LocalComputeItem {
  id: string
  label: string
  status: 'running' | 'stopped' | 'starting'
  type: 'comfyui' | 'gpu'
  port?: number
  device?: string
  gpu?: string
}

interface ModalDeploymentStatus {
  id: string
  name: string
  status: 'deploying' | 'deployed' | 'failed'
  gpu: string
  warm: boolean | null
  url: string
  error?: string
}

export type InferenceServerStatus = 'checking' | 'running' | 'starting' | 'stopped'

interface ComputeBannerProps {
  mode: 'local' | 'cloud' | 'all'
  /** Local compute targets */
  localCompute: LocalComputeItem[]
  /** Modal deploy props (required for cloud/all modes) */
  pluginId?: string
  defaultGpu?: string
  requiredSecrets?: string[]
  deployments?: ModalDeploymentStatus[]
  onDeployed?: () => void
  /** API-engine inference server integration */
  inferenceServer?: {
    status: InferenceServerStatus
    onStart: () => void
    onStop: () => void
    starting: boolean
    stopping: boolean
    error: string | null
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Inference server hook (extracted from LocalInferenceSetup) ──────────────

// Global status for cross-component sync
let _globalInfStatus: InferenceServerStatus = 'checking'
const _infListeners = new Set<(s: InferenceServerStatus) => void>()
function setGlobalInfStatus(s: InferenceServerStatus) {
  _globalInfStatus = s
  _infListeners.forEach((fn) => fn(s))
}

export function useInferenceServer(pluginId?: string | null, enabled = true) {
  const [status, setStatus] = useState<InferenceServerStatus>(_globalInfStatus)
  const [installing, setInstalling] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusRef = useRef<InferenceServerStatus>('checking')

  // Sync with global listeners
  useEffect(() => {
    const handler = (s: InferenceServerStatus) => setStatus(s)
    _infListeners.add(handler)
    return () => { _infListeners.delete(handler) }
  }, [])

  function applyStatus(next: InferenceServerStatus) {
    statusRef.current = next
    setStatus(next)
    setGlobalInfStatus(next)
  }

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/local-inference/status${pluginId ? `?pluginId=${pluginId}` : ''}`)
      const data = await res.json() as { status?: string; running: boolean }
      const serverStatus = data.status as InferenceServerStatus | undefined
      if (serverStatus === 'running') applyStatus('running')
      else if (serverStatus === 'starting') applyStatus('starting')
      else if (serverStatus === 'stopped') applyStatus('stopped')
      else applyStatus(data.running ? 'running' : 'stopped')
    } catch { /* ignore */ }
  }, [pluginId])

  useEffect(() => {
    if (!enabled) return
    checkStatus()
    pollRef.current = setInterval(checkStatus, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [checkStatus, enabled])

  // Navigation guard
  const isActive = installing || status === 'starting'
  useEffect(() => {
    if (!isActive) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('#')) return
      const ok = window.confirm(
        'The inference server is still setting up (downloading model / installing dependencies). ' +
        'It will continue in the background, but you won\'t be able to see progress.\n\nLeave this page?'
      )
      if (!ok) { e.preventDefault(); e.stopPropagation() }
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [isActive])

  const handleStart = useCallback(async () => {
    setInstalling(true)
    setError(null)
    try {
      const res = await fetch(`/api/local-inference/install${pluginId ? `?pluginId=${pluginId}` : ''}`, { method: 'POST' })
      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6)) as { log?: string; error?: string; done?: boolean; starting?: boolean }
            if (payload.error) { setError(payload.error); break }
            if (payload.starting) applyStatus('starting')
            if (payload.done) applyStatus('running')
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed')
    } finally {
      setInstalling(false)
      checkStatus()
    }
  }, [pluginId, checkStatus])

  const handleStop = useCallback(async () => {
    setStopping(true)
    try {
      await fetch(`/api/local-inference/stop${pluginId ? `?pluginId=${pluginId}` : ''}`, { method: 'POST' })
      applyStatus('stopped')
    } finally {
      setStopping(false)
    }
  }, [pluginId])

  return {
    status,
    installing,
    stopping,
    error,
    handleStart,
    handleStop,
    inferenceServerProps: {
      status,
      onStart: handleStart,
      onStop: handleStop,
      starting: installing,
      stopping,
      error,
    } satisfies ComputeBannerProps['inferenceServer'],
  }
}

// Re-export for components that just need to read status
export function useInferenceStatusOnly(): InferenceServerStatus {
  const [s, setS] = useState<InferenceServerStatus>(_globalInfStatus)
  useEffect(() => {
    _infListeners.add(setS)
    return () => { _infListeners.delete(setS) }
  }, [])
  return s
}

// ── Component ───────────────────────────────────────────────────────────────

export function ComputeBanner({
  mode,
  localCompute,
  pluginId,
  defaultGpu,
  requiredSecrets,
  deployments = [],
  onDeployed,
  inferenceServer,
}: ComputeBannerProps) {
  const [expanded, setExpanded] = useState(false)
  const [showPopup, setShowPopup] = useState(false)
  const [popupGpu, setPopupGpu] = useState(defaultGpu || 'A10')
  const [popupName, setPopupName] = useState(() =>
    pluginId ? generateDeployName(pluginId, defaultGpu || 'A10', deployments) : '',
  )

  // Optimistic pending deploys
  const [pendingDeploys, setPendingDeploys] = useState<ModalDeploymentStatus[]>([])
  const [undeployingIds, setUndeployingIds] = useState<Set<string>>(new Set())
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set())
  const [confirmUndeployId, setConfirmUndeployId] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)

  // Merge server deployments with optimistic pending
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

  // Counts
  const localRunning = localCompute.filter(c => c.status === 'running').length
  const cloudDeployedCount = allDeployments.filter(d => d.status === 'deployed').length
  const cloudDeployingCount = allDeployments.filter(d => d.status === 'deploying').length
  const cloudFailedCount = allDeployments.filter(d => d.status === 'failed').length

  const showLocal = mode === 'local' || mode === 'all'
  const showCloud = mode === 'cloud' || mode === 'all'
  const hasCloudContent = allDeployments.length > 0
  const hasLocalContent = localCompute.length > 0
  const hasContent = (showLocal && hasLocalContent) || (showCloud && hasCloudContent)

  // Poll deploy logs when deploying or viewing logs
  const { data: logData } = useQuery<{ logs: string }>({
    queryKey: ['modal-deploy-logs', pluginId],
    queryFn: async () => {
      const res = await fetch(`/api/modal/deploy/${pluginId}?health=false&logs=true`)
      if (!res.ok) return { logs: '' }
      const data = await res.json()
      return { logs: data.logs ?? '' }
    },
    enabled: !!pluginId && (showLogs || isAnyDeploying),
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

  // Deploy mutation
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

  // Undeploy mutation
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

  function handleOpenPopup() {
    const gpu = defaultGpu || 'A10'
    const name = pluginId ? generateDeployName(pluginId, gpu, deployments) : ''
    setPopupGpu(gpu)
    setPopupName(name)
    setShowPopup(true)
  }

  function handlePopupGpuChange(gpu: string) {
    setPopupGpu(gpu)
    setPopupName(pluginId ? generateDeployName(pluginId, gpu, deployments) : '')
  }

  // Inference server shorthand
  const inf = inferenceServer
  const infStatus = inf?.status
  const isInfRunning = infStatus === 'running'
  const isInfStopped = infStatus === 'stopped'
  const isInfStarting = infStatus === 'starting'
  const isInfChecking = infStatus === 'checking'

  // Banner color scheme
  const bannerBg = mode === 'local' ? 'bg-zinc-900/60' : mode === 'cloud' ? 'bg-purple-950/20' : 'bg-zinc-900/40'
  const bannerBorder = mode === 'local' ? 'border-zinc-800/50' : mode === 'cloud' ? 'border-purple-900/30' : 'border-zinc-800/40'

  // Label and icon
  const bannerLabel = mode === 'all' ? 'Compute' : mode === 'cloud' ? 'Modal' : 'Local'
  const BannerIcon = mode === 'all' ? Shuffle : mode === 'cloud' ? Cloud : Desktop
  const iconColor = mode === 'all' ? 'text-cyan-400' : mode === 'cloud' ? 'text-purple-400' : 'text-zinc-400'
  const labelColor = mode === 'all' ? 'text-cyan-300' : mode === 'cloud' ? 'text-purple-300' : 'text-zinc-300'

  return (
    <div className={`px-6 py-2 ${bannerBg} border-b ${bannerBorder} text-sm relative`}>
      {/* Header row */}
      <div className="flex items-center gap-2">
        <BannerIcon size={14} weight="duotone" className={`${iconColor} shrink-0`} />
        <span className={`${labelColor} text-xs font-medium`}>{bannerLabel}</span>

        {/* Status chips */}
        <div className="flex items-center gap-1.5">
          {/* Local inference server status (API tools) */}
          {showLocal && inf && (
            <>
              {isInfChecking && <Spinner size={10} className="text-zinc-400 animate-spin" />}
              {isInfRunning && !inf.starting && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <CheckCircle size={10} weight="fill" />
                  Server running
                </span>
              )}
              {isInfStarting && !inf.starting && (
                <span className="flex items-center gap-1 text-[10px] text-amber-400">
                  <Spinner size={10} className="animate-spin" />
                  Loading model…
                </span>
              )}
              {isInfStopped && !inf.starting && (
                <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                  <WarningCircle size={10} weight="fill" />
                  Server stopped
                </span>
              )}
              {inf.starting && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <Spinner size={10} className="animate-spin" />
                  Installing…
                </span>
              )}
            </>
          )}

          {/* Local ComfyUI instance count (non-API tools) */}
          {showLocal && !inf && localRunning > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <Desktop size={10} />
              {localRunning}
            </span>
          )}

          {showCloud && cloudDeployedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {cloudDeployedCount}
            </span>
          )}
          {showCloud && cloudDeployingCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-purple-400">
              <Spinner size={10} className="animate-spin" />
              {cloudDeployingCount}
            </span>
          )}
          {showCloud && cloudFailedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-red-400">
              <Warning size={10} />
              {cloudFailedCount}
            </span>
          )}
        </div>

        {/* Right side buttons — only View Compute + Add Deployment */}
        <div className="ml-auto flex items-center gap-1.5">
          {hasContent && (
            <button
              onClick={() => setExpanded(v => !v)}
              className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-colors border ${
                mode === 'cloud'
                  ? 'text-purple-300 hover:text-purple-200 bg-purple-900/40 hover:bg-purple-900/60 border-purple-800/30'
                  : mode === 'all'
                    ? 'text-cyan-300 hover:text-cyan-200 bg-cyan-900/30 hover:bg-cyan-900/50 border-cyan-800/30'
                    : 'text-zinc-300 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800/80 border-zinc-700/40'
              }`}
            >
              {expanded ? 'Hide' : 'View'} Compute
              {expanded ? <CaretUp size={10} /> : <CaretDown size={10} />}
            </button>
          )}

          {showCloud && pluginId && (
            <button
              onClick={handleOpenPopup}
              disabled={isAnyDeploying}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
            >
              + Add Deployment
            </button>
          )}
        </div>
      </div>

      {/* Inference server error */}
      {inf?.error && showLocal && (
        <div className="mt-1.5 px-3 py-1.5 bg-red-950/40 border border-red-900/40 rounded text-xs text-red-400">
          {inf.error}
        </div>
      )}

      {/* Expanded content */}
      {expanded && hasContent && (
        <div className="mt-2 flex flex-col gap-1.5">
          {/* Local section */}
          {showLocal && hasLocalContent && (
            <div className="flex flex-col gap-1">
              {(mode === 'all') && (
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Desktop size={10} className="text-zinc-500" />
                  <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider flex-1">Local</span>
                  {/* Inference server start/stop in local section header */}
                  {inf && (isInfRunning || isInfStarting) && (
                    <button
                      onClick={inf.onStop}
                      disabled={inf.stopping}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded transition-colors disabled:opacity-50"
                    >
                      <Stop size={9} weight="fill" />
                      {inf.stopping ? 'Stopping…' : 'Stop Server'}
                    </button>
                  )}
                  {inf && (isInfStopped) && !inf.starting && (
                    <button
                      onClick={inf.onStart}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-black bg-emerald-400 hover:bg-emerald-300 rounded transition-colors"
                    >
                      <Play size={9} weight="fill" /> Start Server
                    </button>
                  )}
                  {inf?.starting && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <Spinner size={9} className="animate-spin" /> Installing…
                    </span>
                  )}
                </div>
              )}
              {/* Inference server controls when not in 'all' mode (local-only) */}
              {mode !== 'all' && inf && (
                <div className="flex items-center gap-1.5 mb-0.5">
                  {inf && (isInfRunning || isInfStarting) && (
                    <button
                      onClick={inf.onStop}
                      disabled={inf.stopping}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded transition-colors disabled:opacity-50"
                    >
                      <Stop size={9} weight="fill" />
                      {inf.stopping ? 'Stopping…' : 'Stop Server'}
                    </button>
                  )}
                  {inf && isInfStopped && !inf.starting && (
                    <button
                      onClick={inf.onStart}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-black bg-emerald-400 hover:bg-emerald-300 rounded transition-colors"
                    >
                      <Play size={9} weight="fill" /> Start Server
                    </button>
                  )}
                  {inf.starting && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <Spinner size={9} className="animate-spin" /> Installing…
                    </span>
                  )}
                </div>
              )}
              {localCompute.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 py-1 px-2 rounded border ${
                    item.status === 'running'
                      ? 'bg-zinc-900/50 border-zinc-800/40'
                      : 'bg-zinc-900/30 border-zinc-800/20 opacity-50'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    item.status === 'running' ? 'bg-emerald-400' : item.status === 'starting' ? 'bg-amber-400 animate-pulse' : 'bg-zinc-600'
                  }`} />
                  <span className="text-xs text-zinc-300 truncate flex-1">
                    {item.label}
                  </span>
                  {item.gpu && (
                    <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400 rounded shrink-0">
                      {item.gpu}
                    </span>
                  )}
                  <span className={`text-[10px] shrink-0 ${
                    item.status === 'running' ? 'text-emerald-400' : item.status === 'starting' ? 'text-amber-400' : 'text-zinc-600'
                  }`}>
                    {item.status === 'running' ? 'Running' : item.status === 'starting' ? 'Starting' : 'Stopped'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Cloud section */}
          {showCloud && hasCloudContent && (
            <div className="flex flex-col gap-1">
              {(mode === 'all') && (
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Cloud size={10} className="text-purple-500" />
                  <span className="text-[10px] font-medium text-purple-500/80 uppercase tracking-wider">Cloud (Modal)</span>
                </div>
              )}
              {allDeployments.map((deployment) => {
                const isStopping = undeployingIds.has(deployment.id)
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
                      {(deployment.status === 'deploying' || isStopping) && (
                        <Spinner size={12} className="animate-spin text-purple-400 shrink-0" />
                      )}
                      {isFailed && (
                        <Warning size={12} className="text-red-400 shrink-0" />
                      )}
                      {deployment.status === 'deployed' && !isStopping && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      )}
                      <span className={`text-xs truncate flex-1 ${isFailed ? 'text-red-300' : 'text-purple-200'}`}>
                        {deployment.name}
                        {isStopping && <span className="text-red-400 ml-1">Stopping...</span>}
                        {isFailed && <span className="text-red-400 ml-1">Failed</span>}
                      </span>

                      <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400 rounded shrink-0">
                        {deployment.gpu}
                      </span>

                      {deployment.status === 'deployed' && deployment.warm !== null && (
                        <span className={`flex items-center gap-1 text-[10px] shrink-0 ${deployment.warm ? 'text-emerald-400' : 'text-zinc-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${deployment.warm ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                          {deployment.warm ? 'Warm' : 'Cold'}
                        </span>
                      )}

                      {isFailed && deployment.error && (
                        <button onClick={() => toggleError(deployment.id)} className="text-red-400 hover:text-red-300 transition-colors shrink-0" title="Show error details">
                          {isErrorExpanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
                        </button>
                      )}

                      <button
                        onClick={() => setConfirmUndeployId(deployment.id)}
                        disabled={isStopping}
                        className="ml-1 text-zinc-600 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                        title={isFailed ? 'Dismiss' : 'Undeploy'}
                      >
                        <X size={12} />
                      </button>
                    </div>

                    {isFailed && isErrorExpanded && deployment.error && (
                      <div className="mt-1 px-2 py-1.5 bg-red-950/20 border border-red-500/10 rounded text-[11px] font-mono text-red-300/80 max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                        {deployment.error}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Deploy logs toggle + panel */}
              {hasFailedOrDeploying && (
                <button
                  onClick={() => setShowLogs((v) => !v)}
                  className="mt-1 flex items-center gap-1 text-[11px] text-purple-400/70 hover:text-purple-300 transition-colors"
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
            </div>
          )}
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
