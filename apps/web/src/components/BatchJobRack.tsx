'use client'

import { useState, useEffect, useRef } from 'react'
import {
  CheckCircle,
  XCircle,
  Clock,
  X,
  Stop,
  Trash,
  ImageSquare,
  Eye,
} from 'phosphor-react'

type OutputItem =
  | { kind: 'image' | 'video' | 'audio' | 'model' | 'file'; filename: string; path: string }
  | { kind: 'text'; text: string }

export type BatchJobStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'error'

export interface BatchJobView {
  id: number
  status: BatchJobStatus
  execId?: string
  outputs: OutputItem[]
  computeLabel?: string
  comfyPort?: number
  startedAt?: number
  completedAt?: number
  errorMessage?: string
  seed: number
}

// ── Lottie-free spinner ──────────────────────────────────────────────────────

function Dots() {
  return (
    <span className="inline-flex gap-0.5 items-center">
      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDelay: '0ms' }} />
      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDelay: '150ms' }} />
      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDelay: '300ms' }} />
    </span>
  )
}

function Elapsed({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!startedAt) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [startedAt])
  if (!startedAt) return null
  const secs = Math.floor((now - startedAt) / 1000)
  if (secs < 60) return <span className="tabular-nums">{secs}s</span>
  return <span className="tabular-nums">{Math.floor(secs / 60)}m {secs % 60}s</span>
}

function Duration({ startedAt, completedAt }: { startedAt?: number; completedAt?: number }) {
  if (!startedAt || !completedAt) return null
  const secs = ((completedAt - startedAt) / 1000).toFixed(1)
  return <span className="tabular-nums">{secs}s</span>
}

// ── Thumbnail ────────────────────────────────────────────────────────────────

function Thumbnail({ out }: { out: Exclude<OutputItem, { kind: 'text' }> }) {
  const url = out.path?.startsWith('/') ? out.path : null
  if (!url) return null
  if (out.kind === 'image') {
    return <img src={url} alt={out.filename} className="size-8 rounded object-cover border border-white/10" loading="lazy" />
  }
  return (
    <div className="size-8 rounded border border-white/10 bg-zinc-900 flex items-center justify-center">
      <ImageSquare size={12} className="text-zinc-600" />
    </div>
  )
}

// ── Single row ───────────────────────────────────────────────────────────────

function JobRow({
  job,
  index,
  onView,
  onCancel,
  isViewing,
}: {
  job: BatchJobView
  index: number
  onView: (job: BatchJobView) => void
  onCancel: (job: BatchJobView) => void
  isViewing: boolean
}) {
  const fileThumbs = job.outputs.filter(
    (o): o is Exclude<OutputItem, { kind: 'text' }> => o.kind !== 'text',
  )

  return (
    <div
      onClick={() => {
        if (job.status === 'completed' || job.status === 'running') onView(job)
      }}
      className={[
        'flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-xs',
        job.status === 'completed' || job.status === 'running'
          ? 'cursor-pointer hover:border-emerald-500/30'
          : '',
        isViewing
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : 'border-white/5 hover:bg-white/[0.02]',
      ].join(' ')}
    >
      {/* Index */}
      <span className="text-zinc-600 font-mono w-5 text-right shrink-0">#{index + 1}</span>

      {/* Status indicator */}
      <span className="shrink-0">
        {job.status === 'queued' && <Clock size={14} className="text-zinc-500" />}
        {job.status === 'dispatching' && <Dots />}
        {job.status === 'running' && <Dots />}
        {job.status === 'completed' && <CheckCircle size={14} weight="fill" className="text-emerald-500" />}
        {job.status === 'error' && <XCircle size={14} weight="fill" className="text-red-500" />}
      </span>

      {/* Status label */}
      <span className={[
        'w-16 shrink-0',
        job.status === 'queued' ? 'text-zinc-500' : '',
        job.status === 'dispatching' ? 'text-amber-400' : '',
        job.status === 'running' ? 'text-amber-400' : '',
        job.status === 'completed' ? 'text-emerald-400' : '',
        job.status === 'error' ? 'text-red-400' : '',
      ].join(' ')}>
        {job.status === 'queued' && 'Queued'}
        {job.status === 'dispatching' && 'Starting'}
        {job.status === 'running' && 'Running'}
        {job.status === 'completed' && 'Done'}
        {job.status === 'error' && 'Error'}
      </span>

      {/* Compute label */}
      {job.computeLabel && (
        <span className="text-zinc-500 truncate max-w-[120px] shrink-0">
          {job.computeLabel}
        </span>
      )}

      {/* Error message */}
      {job.status === 'error' && job.errorMessage && (
        <span className="text-red-400/70 truncate flex-1">{job.errorMessage}</span>
      )}

      {/* Thumbnails for completed */}
      {job.status === 'completed' && fileThumbs.length > 0 && (
        <div className="flex gap-1 flex-1 min-w-0 overflow-hidden">
          {fileThumbs.slice(0, 4).map((out, i) => (
            <Thumbnail key={i} out={out} />
          ))}
          {fileThumbs.length > 4 && (
            <span className="text-zinc-600 text-[10px] self-center">+{fileThumbs.length - 4}</span>
          )}
        </div>
      )}

      {/* Spacer for non-completed rows */}
      {job.status !== 'completed' && job.status !== 'error' && <div className="flex-1" />}

      {/* Timing */}
      <span className="text-zinc-600 font-mono shrink-0">
        {(job.status === 'running' || job.status === 'dispatching') && (
          <Elapsed startedAt={job.startedAt} />
        )}
        {job.status === 'completed' && (
          <Duration startedAt={job.startedAt} completedAt={job.completedAt} />
        )}
      </span>

      {/* Actions */}
      <span className="shrink-0 flex items-center gap-1">
        {job.status === 'completed' && (
          <button
            onClick={(e) => { e.stopPropagation(); onView(job) }}
            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="View outputs"
          >
            <Eye size={12} />
          </button>
        )}
        {job.status === 'queued' && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(job) }}
            className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
            title="Remove from queue"
          >
            <X size={12} />
          </button>
        )}
        {job.status === 'running' && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(job) }}
            className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
            title="Cancel"
          >
            <Stop size={12} weight="fill" />
          </button>
        )}
      </span>
    </div>
  )
}

// ── Rack component ───────────────────────────────────────────────────────────

interface BatchJobRackProps {
  jobs: BatchJobView[]
  viewingJobId: number | null
  onViewJob: (job: BatchJobView) => void
  onCancelJob: (job: BatchJobView) => void
  onCancelAll: () => void
  onClearFinished: () => void
  queuedCount: number
  runningCount: number
  completedCount: number
  errorCount: number
}

export function BatchJobRack({
  jobs,
  viewingJobId,
  onViewJob,
  onCancelJob,
  onCancelAll,
  onClearFinished,
  queuedCount,
  runningCount,
  completedCount,
  errorCount,
}: BatchJobRackProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new jobs are added
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [jobs.length])

  const hasActive = queuedCount > 0 || runningCount > 0
  const hasFinished = completedCount > 0 || errorCount > 0

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="flex items-center gap-2 text-xs flex-1">
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <Dots /> {runningCount} running
            </span>
          )}
          {queuedCount > 0 && (
            <span className="text-zinc-500">
              {queuedCount} queued
            </span>
          )}
          {completedCount > 0 && (
            <span className="text-emerald-400/70">
              {completedCount} completed
            </span>
          )}
          {errorCount > 0 && (
            <span className="text-red-400/70">
              {errorCount} failed
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {hasFinished && (
            <button
              onClick={onClearFinished}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              title="Clear finished"
            >
              <Trash size={10} /> Clear
            </button>
          )}
          {hasActive && (
            <button
              onClick={onCancelAll}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-red-500/70 hover:text-red-400 transition-colors"
            >
              <Stop size={10} weight="fill" /> Cancel all
            </button>
          )}
        </div>
      </div>

      {/* Job list */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
        {jobs.map((job, i) => (
          <JobRow
            key={job.id}
            job={job}
            index={i}
            onView={onViewJob}
            onCancel={onCancelJob}
            isViewing={job.id === viewingJobId}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
