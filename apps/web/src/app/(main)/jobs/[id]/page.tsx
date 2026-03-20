'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  ArrowLeft,
  CircleNotch,
  CheckCircle,
  XCircle,
  Clock,
  ArrowClockwise,
  Stop,
  ImageSquare,
  Warning,
} from 'phosphor-react'
import { PageTransition } from '@/components/ui'

interface ExecutionDetail {
  id: string
  toolId: string
  toolName?: string
  userId: string | null
  inputsJson: string
  outputsJson: string | null
  seed: number | null
  promptId: string | null
  workflowHash: string
  status: string
  errorMessage: string | null
  metadataJson: string | null
  createdAt: number
  completedAt: number | null
}

type OutputItem = {
  filename?: string
  kind?: string
  path?: string
  text?: string
  subfolder?: string
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatDuration(startMs: number, endMs: number | null): string {
  const elapsed = (endMs ?? Date.now()) - startMs
  if (elapsed < 0) return '--'
  const totalSeconds = Math.floor(elapsed / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return `${hours}h ${remainMinutes}m`
}

function inferKind(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) return 'image'
  if (['gif', 'mp4', 'webm', 'avi', 'mov'].includes(ext)) return 'video'
  if (['wav', 'mp3', 'flac', 'ogg', 'aiff', 'm4a'].includes(ext)) return 'audio'
  return 'file'
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: React.ReactNode; label: string; classes: string }> = {
    running: {
      icon: <CircleNotch size={14} weight="bold" className="animate-spin" />,
      label: 'Running',
      classes: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    },
    completed: {
      icon: <CheckCircle size={14} weight="fill" />,
      label: 'Completed',
      classes: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    },
    error: {
      icon: <XCircle size={14} weight="fill" />,
      label: 'Error',
      classes: 'text-red-400 bg-red-500/10 border-red-500/20',
    },
  }
  const c = config[status] ?? { icon: null, label: status, classes: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20' }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${c.classes}`}>
      {c.icon}
      {c.label}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[var(--color-background-panel)] overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const { data: execution, isLoading, error } = useQuery<ExecutionDetail>({
    queryKey: ['execution', id],
    queryFn: async () => {
      const res = await fetch(`/api/executions/${id}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
    refetchInterval: (query) => {
      return query.state.data?.status === 'running' ? 3000 : false
    },
  })

  if (isLoading) {
    return (
      <PageTransition className="h-full flex items-center justify-center bg-[var(--color-background)]">
        <CircleNotch size={24} className="text-zinc-500 animate-spin" />
      </PageTransition>
    )
  }

  if (error || !execution) {
    return (
      <PageTransition className="h-full flex flex-col items-center justify-center bg-[var(--color-background)] gap-3">
        <XCircle size={32} className="text-zinc-600" />
        <p className="text-sm text-zinc-500">Execution not found</p>
        <Link href="/jobs" className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
          Back to Jobs
        </Link>
      </PageTransition>
    )
  }

  // Parse inputs
  let inputs: Record<string, unknown> = {}
  try { inputs = JSON.parse(execution.inputsJson || '{}') } catch { /* skip */ }

  // Parse outputs
  let outputs: OutputItem[] = []
  try { outputs = JSON.parse(execution.outputsJson || '[]') } catch { /* skip */ }

  // Parse metadata
  let metadata: Record<string, unknown> = {}
  try { metadata = JSON.parse(execution.metadataJson || '{}') } catch { /* skip */ }

  const handleCancel = async () => {
    try {
      await fetch(`/api/executions/${id}/cancel`, { method: 'POST' })
      router.refresh()
    } catch { /* skip */ }
  }

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-8 py-5 border-b border-white/5 shrink-0">
        <button
          onClick={() => router.push('/jobs')}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={16} />
          Jobs
        </button>
        <div className="w-px h-5 bg-white/5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-tech text-lg font-semibold text-zinc-100 truncate">
              {execution.id.slice(0, 8)}
            </h1>
            <StatusBadge status={execution.status} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {execution.status === 'running' && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 rounded-lg transition-colors"
            >
              <Stop size={14} weight="fill" />
              Cancel
            </button>
          )}
          {execution.status === 'error' && (
            <Link
              href={`/tools/${execution.toolId}`}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 rounded-lg transition-colors"
            >
              <ArrowClockwise size={14} />
              Retry
            </Link>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Timing info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/5 bg-[var(--color-background-panel)] px-5 py-4">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Started</p>
              <p className="text-sm text-zinc-300 flex items-center gap-2">
                <Clock size={14} className="text-zinc-500" />
                {timeAgo(execution.createdAt)}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-[var(--color-background-panel)] px-5 py-4">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Duration</p>
              <p className="text-sm text-zinc-300 font-mono">
                {formatDuration(execution.createdAt, execution.completedAt)}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-[var(--color-background-panel)] px-5 py-4">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Tool</p>
              <Link
                href={`/tools/${execution.toolId}`}
                className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors truncate block"
              >
                {execution.toolName ?? execution.toolId.slice(0, 8)}
              </Link>
            </div>
          </div>

          {/* Error message */}
          {execution.status === 'error' && execution.errorMessage && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
              <div className="px-5 py-3 border-b border-red-500/10 flex items-center gap-2">
                <Warning size={14} weight="fill" className="text-red-400" />
                <h3 className="text-xs font-medium text-red-400 uppercase tracking-wider">Error</h3>
              </div>
              <div className="p-5">
                <p className="text-sm text-red-300 font-mono whitespace-pre-wrap leading-relaxed">
                  {execution.errorMessage}
                </p>
              </div>
            </div>
          )}

          {/* Inputs */}
          {Object.keys(inputs).length > 0 && (
            <Section title="Inputs">
              <div className="grid grid-cols-1 gap-3">
                {Object.entries(inputs).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-[11px] text-zinc-500 mb-0.5">{key.replace(/__/g, ' > ')}</p>
                    <p className="text-sm text-zinc-300 break-words leading-relaxed font-mono">
                      {typeof value === 'string' ? (value || '(empty)') : JSON.stringify(value)}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Outputs */}
          {outputs.length > 0 && (
            <Section title="Outputs">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {outputs.map((item, i) => {
                  if (item.text) {
                    return (
                      <div key={i} className="rounded-lg border border-white/5 bg-zinc-950 p-3 overflow-hidden">
                        <p className="text-xs text-zinc-400 font-mono leading-relaxed line-clamp-6">
                          {item.text}
                        </p>
                      </div>
                    )
                  }
                  if (!item.filename) return null
                  const kind = item.kind || inferKind(item.filename)
                  const url = item.path?.startsWith('/') ? item.path : null
                  if (kind === 'image' && url) {
                    return (
                      <div key={i} className="rounded-lg border border-white/5 bg-zinc-950 overflow-hidden">
                        <img src={url} alt={item.filename} className="w-full h-36 object-cover" loading="lazy" />
                        <p className="px-2 py-1.5 text-[10px] text-zinc-500 truncate">{item.filename}</p>
                      </div>
                    )
                  }
                  if (kind === 'video' && url) {
                    return (
                      <div key={i} className="rounded-lg border border-white/5 bg-zinc-950 overflow-hidden">
                        <video src={url} controls className="w-full h-36 object-cover" />
                        <p className="px-2 py-1.5 text-[10px] text-zinc-500 truncate">{item.filename}</p>
                      </div>
                    )
                  }
                  if (kind === 'audio' && url) {
                    return (
                      <div key={i} className="rounded-lg border border-white/5 bg-zinc-950 overflow-hidden p-3">
                        <audio controls src={url} className="w-full" />
                        <p className="mt-2 text-[10px] text-zinc-500 truncate">{item.filename}</p>
                      </div>
                    )
                  }
                  return (
                    <div key={i} className="rounded-lg border border-white/5 bg-zinc-950 p-3 flex items-center gap-2">
                      <ImageSquare size={16} className="text-zinc-600 shrink-0" />
                      <p className="text-xs text-zinc-500 truncate">{item.filename}</p>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Metadata */}
          {Object.keys(metadata).length > 0 && (
            <Section title="Metadata">
              <div className="grid grid-cols-1 gap-3">
                {Object.entries(metadata).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-[11px] text-zinc-500 mb-0.5">{key}</p>
                    <p className="text-sm text-zinc-300 break-words leading-relaxed font-mono">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Raw IDs */}
          <Section title="Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-zinc-500 mb-0.5">Execution ID</p>
                <p className="text-sm text-zinc-400 font-mono">{execution.id}</p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-500 mb-0.5">Tool ID</p>
                <p className="text-sm text-zinc-400 font-mono">{execution.toolId}</p>
              </div>
              {execution.promptId && (
                <div>
                  <p className="text-[11px] text-zinc-500 mb-0.5">Prompt ID</p>
                  <p className="text-sm text-zinc-400 font-mono">{execution.promptId}</p>
                </div>
              )}
              {execution.seed != null && (
                <div>
                  <p className="text-[11px] text-zinc-500 mb-0.5">Seed</p>
                  <p className="text-sm text-zinc-400 font-mono">{execution.seed}</p>
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>
    </PageTransition>
  )
}
