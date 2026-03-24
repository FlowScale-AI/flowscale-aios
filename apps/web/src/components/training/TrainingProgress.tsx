'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'phosphor-react'

interface TrainingProgressProps {
  toolId: string
  executionId: string
  onComplete: () => void
  onError: (message: string) => void
}

interface ProgressState {
  step: number
  total: number
  loss: number | null
  speed: number | null
  lr: number | null
}

export function TrainingProgress({ toolId, executionId, onComplete, onError }: TrainingProgressProps) {
  const [progress, setProgress] = useState<ProgressState>({
    step: 0,
    total: 0,
    loss: null,
    speed: null,
    lr: null,
  })
  const [logs, setLogs] = useState<string[]>([])
  const [cancelling, setCancelling] = useState(false)
  const [startTime] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // SSE connection
  useEffect(() => {
    const url = `/api/tools/${toolId}/executions/${executionId}/progress`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (event) => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(event.data as string) as Record<string, unknown>
      } catch {
        setLogs((prev) => [...prev, event.data as string])
        return
      }

      const type = parsed.type as string | undefined

      if (type === 'step') {
        setProgress({
          step: (parsed.step as number) ?? 0,
          total: (parsed.total as number) ?? 0,
          loss: parsed.loss != null ? (parsed.loss as number) : null,
          speed: parsed.speed != null ? (parsed.speed as number) : null,
          lr: parsed.lr != null ? (parsed.lr as number) : null,
        })
        const logLine = `[${String(parsed.step ?? 0).padStart(5)}/${String(parsed.total ?? 0)}]` +
          (parsed.loss != null ? `  loss=${(parsed.loss as number).toFixed(4)}` : '') +
          (parsed.speed != null ? `  speed=${(parsed.speed as number).toFixed(2)} it/s` : '') +
          (parsed.lr != null ? `  lr=${(parsed.lr as number).toExponential(1)}` : '')
        setLogs((prev) => [...prev, logLine])
      } else if (type === 'log') {
        setLogs((prev) => [...prev, (parsed.message as string) ?? event.data as string])
      } else if (type === 'complete') {
        es.close()
        onComplete()
      } else if (type === 'error') {
        es.close()
        onError((parsed.message as string) ?? 'Training failed')
      }
    }

    es.onerror = () => {
      es.close()
    }

    return () => {
      es.close()
    }
  }, [toolId, executionId, onComplete, onError])

  async function handleCancel() {
    setCancelling(true)
    try {
      await fetch(`/api/tools/${toolId}/executions/${executionId}/cancel`, { method: 'POST' })
    } catch {
      // best-effort
    } finally {
      setCancelling(false)
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.step / progress.total) * 100) : 0

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const eta = progress.step > 0 && progress.total > 0
    ? Math.round((elapsed / progress.step) * (progress.total - progress.step))
    : null

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Green pulse dot */}
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm font-medium text-zinc-200">Training in progress</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{formatTime(elapsed)} elapsed</span>
          {eta !== null && <span>~{formatTime(eta)} remaining</span>}
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Step {progress.step} / {progress.total || '…'}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-violet-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-0.5 rounded-lg border border-white/5 bg-zinc-900/60 px-3 py-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Loss</span>
          <span className="font-mono text-sm text-zinc-200">
            {progress.loss != null ? progress.loss.toFixed(4) : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg border border-white/5 bg-zinc-900/60 px-3 py-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Speed</span>
          <span className="font-mono text-sm text-zinc-200">
            {progress.speed != null ? `${progress.speed.toFixed(2)} it/s` : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg border border-white/5 bg-zinc-900/60 px-3 py-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">LR</span>
          <span className="font-mono text-sm text-zinc-200">
            {progress.lr != null ? progress.lr.toExponential(1) : '—'}
          </span>
        </div>
      </div>

      {/* Log stream */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Logs</span>
        <div className="h-40 overflow-y-auto rounded-lg border border-white/5 bg-black/40 p-3">
          {logs.length === 0 ? (
            <span className="font-mono text-xs text-zinc-600">Waiting for output…</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="font-mono text-xs text-zinc-400 leading-5 whitespace-pre-wrap">{line}</div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* Cancel */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-red-500/40 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <X size={13} weight="bold" />
          {cancelling ? 'Cancelling…' : 'Cancel Training'}
        </button>
      </div>
    </div>
  )
}
