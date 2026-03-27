import { useState, useCallback, useRef, useEffect } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type BatchJobStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'error'

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
  execId?: string
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
  toolId,
  getTargets,
  dispatchJob,
  onJobComplete,
  onComfyJobStarted,
}: UseBatchQueueOptions) {
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const nextId = useRef(1)
  const dispatchingRef = useRef(false)

  // ── Counts ──────────────────────────────────────────────────────────────────
  const queuedCount = jobs.filter((j) => j.status === 'queued').length
  const runningCount = jobs.filter((j) => j.status === 'running' || j.status === 'dispatching').length
  const completedCount = jobs.filter((j) => j.status === 'completed').length
  const errorCount = jobs.filter((j) => j.status === 'error').length
  const totalCount = jobs.length
  const hasActiveJobs = queuedCount > 0 || runningCount > 0
  const isBatchMode = totalCount > 1 || (totalCount === 1 && queuedCount > 0)

  // ── Enqueue ─────────────────────────────────────────────────────────────────
  const enqueue = useCallback((inputs: Record<string, unknown>, seed: number) => {
    const jobId = nextId.current++
    const job: BatchJob = {
      id: jobId,
      inputs: { ...inputs },
      seed,
      status: 'queued',
      outputs: [],
    }
    setJobs((prev) => [...prev, job])

    // Persist to DB immediately so the record survives page navigation
    fetch(`/api/tools/${toolId}/executions/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs, seed }),
    })
      .then((res) => res.json())
      .then((data: { executionId: string }) => {
        setJobs((prev) => prev.map((j) =>
          j.id === jobId ? { ...j, execId: data.executionId } : j,
        ))
      })
      .catch(() => {
        // If enqueue fails, mark job as errored
        setJobs((prev) => prev.map((j) =>
          j.id === jobId
            ? { ...j, status: 'error' as const, errorMessage: 'Failed to enqueue' }
            : j,
        ))
      })

    return jobId
  }, [toolId])

  // ── Cancel a queued job ────────────────────────────────────────────────────
  const cancelQueued = useCallback((jobId: number) => {
    const job = jobs.find((j) => j.id === jobId && j.status === 'queued')
    if (!job) return
    // Update DB record if it was persisted
    if (job.execId) {
      fetch(`/api/executions/${job.execId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'error', errorMessage: 'Cancelled' }),
      }).catch(() => { /* ignore */ })
    }
    setJobs((prev) => prev.filter((j) => j.id !== jobId))
  }, [jobs])

  // ── Cancel a running job ──────────────────────────────────────────────────
  const cancelRunning = useCallback(async (jobId: number) => {
    const job = jobs.find((j) => j.id === jobId)
    if (!job?.execId) return
    try {
      await fetch(`/api/executions/${job.execId}/cancel`, { method: 'POST' })
      setJobs((prev) => prev.map((j) =>
        j.id === jobId
          ? { ...j, status: 'error' as const, errorMessage: 'Cancelled', completedAt: Date.now() }
          : j,
      ))
    } catch { /* ignore */ }
  }, [jobs])

  // ── Cancel all ──────────────────────────────────────────────────────────────
  const cancelAll = useCallback(async () => {
    // Remove all queued
    const running = jobs.filter((j) => j.status === 'running' && j.execId)
    setJobs((prev) => prev.filter((j) => j.status !== 'queued'))
    // Cancel all running
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
  }, [jobs])

  // ── Clear completed/errored jobs ───────────────────────────────────────────
  const clearFinished = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'dispatching'))
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

  // ── Dispatch logic ─────────────────────────────────────────────────────────
  // Determines available slots and fires jobs
  useEffect(() => {
    if (dispatchingRef.current) return
    // Only dispatch jobs that have been persisted (have execId from enqueue)
    const queued = jobs.filter((j) => j.status === 'queued' && j.execId)
    if (queued.length === 0) return

    const targets = getTargets()
    if (targets.length === 0) return

    // Find targets not currently used by a running/dispatching job
    const busyTargetIds = new Set(
      jobs
        .filter((j) => j.status === 'running' || j.status === 'dispatching')
        .map((j) => j.computeLabel)
        .filter(Boolean),
    )

    const freeTargets = targets.filter((t) => !busyTargetIds.has(t.label))
    if (freeTargets.length === 0) return

    // Dispatch as many queued jobs as we have free targets
    const toDispatch = queued.slice(0, freeTargets.length)

    dispatchingRef.current = true

    // Mark jobs as dispatching with assigned targets
    setJobs((prev) => prev.map((j) => {
      const idx = toDispatch.findIndex((q) => q.id === j.id)
      if (idx === -1) return j
      return { ...j, status: 'dispatching' as const, computeLabel: freeTargets[idx].label, startedAt: Date.now() }
    }))

    // Fire all dispatches in parallel
    Promise.all(
      toDispatch.map(async (job, idx) => {
        const target = freeTargets[idx]
        const payload: DispatchPayload = { inputs: job.inputs, execId: job.execId }

        if (target.provider === 'modal' && target.port) {
          // Modal ComfyUI instance
          payload.comfyPort = target.port
        } else if (target.provider === 'modal' && target.modalDeployId) {
          // Modal API-engine deployment
          payload.provider = 'modal'
          payload.modalDeployId = target.modalDeployId
        } else if (target.port) {
          // Local ComfyUI instance
          payload.comfyPort = target.port
        } else if (target.device) {
          // Local API-engine device
          payload.device = target.device
        }

        try {
          const result = await dispatchJob(payload)
          return { jobId: job.id, result, target, error: null }
        } catch (err) {
          return { jobId: job.id, result: null, target, error: err instanceof Error ? err.message : 'Failed to dispatch' }
        }
      }),
    ).then((results) => {
      setJobs((prev) => prev.map((j) => {
        const res = results.find((r) => r.jobId === j.id)
        if (!res) return j
        if (res.error) {
          return { ...j, status: 'error' as const, errorMessage: res.error, completedAt: Date.now() }
        }
        const updated: BatchJob = {
          ...j,
          status: 'running',
          execId: res.result!.executionId,
          comfyPort: res.result!.comfyPort ?? res.target.port,
        }
        // Notify about ComfyUI jobs that need SSE tracking
        if (res.result!.type === 'comfyui' && onComfyJobStarted) {
          onComfyJobStarted(updated, res.result!)
        }
        return updated
      }))
      dispatchingRef.current = false
    })
  }, [jobs, getTargets, dispatchJob, onComfyJobStarted])

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
    enqueue,
    cancelQueued,
    cancelRunning,
    cancelAll,
    clearFinished,
    clearAll,
    markCompleted,
    markErrored,
    // Counts
    queuedCount,
    runningCount,
    completedCount,
    errorCount,
    totalCount,
    hasActiveJobs,
    isBatchMode,
  }
}
