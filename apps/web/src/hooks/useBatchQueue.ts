import { useState, useCallback, useRef, useEffect } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type BatchJobStatus = 'dispatching' | 'running' | 'completed' | 'error'

export interface BatchJob {
  /** Client-side ID (incremental) */
  id: number
  inputs: Record<string, unknown>
  seed: number
  status: BatchJobStatus
  /** Server-side execution ID (set after dispatch) */
  execId?: string
  /** Resolved outputs */
  outputs: OutputItem[]
  /** Which compute target was assigned */
  computeLabel?: string
  /** ComfyUI port used (for output URL resolution) */
  comfyPort?: number
  /** Timestamps */
  startedAt?: number
  completedAt?: number
  errorMessage?: string
}

type OutputItem =
  | { kind: 'image' | 'video' | 'audio' | 'model' | 'file'; filename: string; path: string }
  | { kind: 'text'; text: string }

/** Describes one available compute slot for dispatch */
export interface ComputeTarget {
  /** Unique identifier: port number for ComfyUI, device string for API */
  id: string
  /** Human-readable label */
  label: string
  /** 'local' or 'modal' */
  provider: 'local' | 'modal'
  /** Port for ComfyUI tools */
  port?: number
  /** Device for API tools */
  device?: string
  /** Modal deploy ID for API-engine Modal */
  modalDeployId?: string
}

interface DispatchPayload {
  inputs: Record<string, unknown>
  comfyPort?: number | 'modal'
  device?: string
  provider?: 'modal'
  modalDeployId?: string
  comfyOrgApiKey?: string
}

interface DispatchResult {
  executionId: string
  type?: 'api' | 'comfyui' | 'modal'
  seed: number
  promptId?: string
  comfyPort?: number
}

interface UseBatchQueueOptions {
  toolId: string
  /** Build available compute targets from current selection & instances */
  getTargets: () => ComputeTarget[]
  /** Execute one job — returns the execution result */
  dispatchJob: (payload: DispatchPayload) => Promise<DispatchResult>
  /** Called when a job completes to refresh execution history */
  onJobComplete?: () => void
  /** Called when a ComfyUI job needs SSE/poll tracking */
  onComfyJobStarted?: (job: BatchJob, result: DispatchResult) => void
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBatchQueue({
  getTargets,
  dispatchJob,
  onJobComplete,
  onComfyJobStarted,
}: UseBatchQueueOptions) {
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const jobsRef = useRef<BatchJob[]>([])
  const nextId = useRef(1)

  useEffect(() => { jobsRef.current = jobs }, [jobs])

  // ── Counts ──────────────────────────────────────────────────────────────────
  const runningCount = jobs.filter((j) => j.status === 'running' || j.status === 'dispatching').length
  const completedCount = jobs.filter((j) => j.status === 'completed').length
  const errorCount = jobs.filter((j) => j.status === 'error').length
  const totalCount = jobs.length
  const hasActiveJobs = runningCount > 0
  const isBatchMode = totalCount > 1

  // ── Check if compute is available ─────────────────────────────────────────
  const hasFreeTarget = useCallback(() => {
    const targets = getTargets()
    if (targets.length === 0) return false
    const busyTargetIds = new Set(
      jobsRef.current
        .filter((j) => j.status === 'running' || j.status === 'dispatching')
        .map((j) => j.computeLabel)
        .filter(Boolean),
    )
    return targets.some((t) => !busyTargetIds.has(t.label))
  }, [getTargets])

  // ── Run immediately (no queuing) ──────────────────────────────────────────
  const run = useCallback(async (inputs: Record<string, unknown>, seed: number): Promise<number | null> => {
    const targets = getTargets()
    if (targets.length === 0) return null

    // Find a free target
    const busyTargetIds = new Set(
      jobsRef.current
        .filter((j) => j.status === 'running' || j.status === 'dispatching')
        .map((j) => j.computeLabel)
        .filter(Boolean),
    )
    const freeTarget = targets.find((t) => !busyTargetIds.has(t.label))
    if (!freeTarget) return null

    const jobId = nextId.current++
    const job: BatchJob = {
      id: jobId,
      inputs: { ...inputs },
      seed,
      status: 'dispatching',
      outputs: [],
      computeLabel: freeTarget.label,
      startedAt: Date.now(),
    }
    setJobs((prev) => [...prev, job])

    // Build dispatch payload
    const payload: DispatchPayload = { inputs }
    if (freeTarget.provider === 'modal' && freeTarget.port) {
      payload.comfyPort = freeTarget.port
    } else if (freeTarget.provider === 'modal' && freeTarget.modalDeployId) {
      payload.provider = 'modal'
      payload.modalDeployId = freeTarget.modalDeployId
    } else if (freeTarget.port) {
      payload.comfyPort = freeTarget.port
    } else if (freeTarget.device) {
      payload.device = freeTarget.device
    }

    try {
      const result = await dispatchJob(payload)
      const updated: BatchJob = {
        ...job,
        status: 'running',
        execId: result.executionId,
        comfyPort: result.comfyPort ?? freeTarget.port,
      }
      setJobs((prev) => prev.map((j) => j.id === jobId ? updated : j))

      // Notify about ComfyUI jobs that need SSE tracking
      if (result.type === 'comfyui' && onComfyJobStarted) {
        onComfyJobStarted(updated, result)
      }
    } catch (err) {
      setJobs((prev) => prev.map((j) =>
        j.id === jobId
          ? { ...j, status: 'error' as const, errorMessage: err instanceof Error ? err.message : 'Failed to dispatch', completedAt: Date.now() }
          : j,
      ))
    }

    return jobId
  }, [getTargets, dispatchJob, onComfyJobStarted])

  // ── Cancel a running job ──────────────────────────────────────────────────
  const cancelRunning = useCallback(async (jobId: number) => {
    const job = jobsRef.current.find((j) => j.id === jobId)
    if (!job?.execId) return
    try {
      await fetch(`/api/executions/${job.execId}/cancel`, { method: 'POST' })
      setJobs((prev) => prev.map((j) =>
        j.id === jobId
          ? { ...j, status: 'error' as const, errorMessage: 'Cancelled', completedAt: Date.now() }
          : j,
      ))
    } catch { /* ignore */ }
  }, [])

  // ── Cancel all running ────────────────────────────────────────────────────
  const cancelAll = useCallback(async () => {
    const running = jobsRef.current.filter((j) => j.status === 'running' && j.execId)
    for (const job of running) {
      try {
        await fetch(`/api/executions/${job.execId}/cancel`, { method: 'POST' })
      } catch { /* ignore */ }
    }
    setJobs((prev) => prev.map((j) =>
      j.status === 'running'
        ? { ...j, status: 'error' as const, errorMessage: 'Cancelled', completedAt: Date.now() }
        : j,
    ))
  }, [])

  // ── Clear completed/errored jobs ───────────────────────────────────────────
  const clearFinished = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === 'running' || j.status === 'dispatching'))
  }, [])

  // ── Clear all jobs (reset) ────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    setJobs([])
  }, [])

  // ── Mark a job completed (called externally when execution finishes) ────────
  const markCompleted = useCallback((execId: string, outputs: OutputItem[]) => {
    setJobs((prev) => prev.map((j) =>
      j.execId === execId
        ? { ...j, status: 'completed' as const, outputs, completedAt: Date.now() }
        : j,
    ))
    onJobComplete?.()
  }, [onJobComplete])

  // ── Mark a job errored ─────────────────────────────────────────────────────
  const markErrored = useCallback((execId: string, errorMessage: string) => {
    setJobs((prev) => prev.map((j) =>
      j.execId === execId
        ? { ...j, status: 'error' as const, errorMessage, completedAt: Date.now() }
        : j,
    ))
    onJobComplete?.()
  }, [onJobComplete])

  // ── Poll for API/Modal job completion ─────────────────────────────────────
  useEffect(() => {
    const runningApiJobs = jobs.filter(
      (j) => j.status === 'running' && j.execId,
    )
    if (runningApiJobs.length === 0) return

    const interval = setInterval(async () => {
      for (const job of runningApiJobs) {
        try {
          const res = await fetch(`/api/executions/${job.execId}`)
          if (!res.ok) continue
          const exec = await res.json()
          if (exec.status === 'completed') {
            const outputs = exec.outputsJson ? JSON.parse(exec.outputsJson) as OutputItem[] : []
            markCompleted(job.execId!, outputs)
          } else if (exec.status === 'error') {
            markErrored(job.execId!, exec.errorMessage || 'Execution failed')
          }
        } catch { /* ignore */ }
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [jobs, markCompleted, markErrored])

  return {
    jobs,
    run,
    hasFreeTarget,
    cancelRunning,
    cancelAll,
    clearFinished,
    clearAll,
    markCompleted,
    markErrored,
    // Counts
    runningCount,
    completedCount,
    errorCount,
    totalCount,
    hasActiveJobs,
    isBatchMode,
  }
}
