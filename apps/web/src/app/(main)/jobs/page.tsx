'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  CircleNotch,
  CheckCircle,
  XCircle,
  ClockCounterClockwise,
  MagnifyingGlass,
} from 'phosphor-react'
import { PageTransition } from '@/components/ui'

type Tab = 'active' | 'completed' | 'failed'

interface ComfyManagedInstance {
  id: string
  status: string
  port: number
  device: string
  label: string
}

interface ExecutionRow {
  id: string
  toolId: string
  toolName: string
  inputsJson: string
  outputsJson: string | null
  seed: number | null
  promptId: string | null
  status: string
  errorMessage: string | null
  metadataJson: string | null
  comfyPort: number | null
  createdAt: number
  completedAt: number | null
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDuration(startMs: number, endMs: number | null): string {
  if (!endMs) {
    // Still running - show elapsed
    const elapsed = Date.now() - startMs
    return formatMs(elapsed)
  }
  return formatMs(endMs - startMs)
}

function formatMs(ms: number): string {
  if (ms < 0) return '--'
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return `${hours}h ${remainMinutes}m`
}

function getJobName(row: ExecutionRow): string {
  try {
    const inputs = JSON.parse(row.inputsJson || '{}')
    // Try to find a text/prompt input to use as a name
    for (const val of Object.values(inputs)) {
      if (typeof val === 'string' && val.length > 0 && val.length < 80) {
        return val.length > 50 ? val.slice(0, 50) + '...' : val
      }
    }
  } catch { /* skip */ }
  return row.id.slice(0, 8)
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <CircleNotch size={14} weight="bold" className="text-amber-400 animate-spin" />
    case 'completed':
      return <CheckCircle size={14} weight="fill" className="text-emerald-400" />
    case 'error':
      return <XCircle size={14} weight="fill" className="text-red-400" />
    default:
      return <CircleNotch size={14} className="text-zinc-500" />
  }
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    completed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    error: 'text-red-400 bg-red-500/10 border-red-500/20',
  }
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${styles[status] ?? 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

export default function JobsPage() {
  const [tab, setTab] = useState<Tab>('active')
  const [search, setSearch] = useState('')
  const router = useRouter()

  const { data: comfyManage } = useQuery<{ instances: ComfyManagedInstance[] }>({
    queryKey: ['comfy-manage'],
    queryFn: async () => {
      const res = await fetch('/api/comfy/manage')
      if (!res.ok) return { instances: [] }
      return res.json()
    },
    staleTime: 30_000,
  })

  const instanceLabelByPort = new Map<number, string>()
  for (const inst of comfyManage?.instances ?? []) {
    instanceLabelByPort.set(inst.port, inst.label)
  }

  const { data: allExecutions = [], isLoading } = useQuery<ExecutionRow[]>({
    queryKey: ['executions-all'],
    queryFn: async () => {
      const res = await fetch('/api/executions?limit=100')
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: tab === 'active' ? 5000 : false,
  })

  const filtered = allExecutions.filter((row) => {
    // Tab filter
    if (tab === 'active' && row.status !== 'running') return false
    if (tab === 'completed' && row.status !== 'completed') return false
    if (tab === 'failed' && row.status !== 'error') return false
    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      const name = getJobName(row).toLowerCase()
      const tool = (row.toolName ?? '').toLowerCase()
      if (!name.includes(q) && !tool.includes(q) && !row.id.toLowerCase().includes(q)) return false
    }
    return true
  })

  const counts = {
    active: allExecutions.filter((r) => r.status === 'running').length,
    completed: allExecutions.filter((r) => r.status === 'completed').length,
    failed: allExecutions.filter((r) => r.status === 'error').length,
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: counts.active },
    { key: 'completed', label: 'Completed', count: counts.completed },
    { key: 'failed', label: 'Failed', count: counts.failed },
  ]

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Jobs</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {allExecutions.length} {allExecutions.length === 1 ? 'execution' : 'executions'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-8 pt-5 shrink-0 border-b border-white/5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2 flex items-center gap-2',
              tab === t.key
                ? 'text-emerald-400 border-emerald-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300',
            ].join(' ')}
          >
            {t.label}
            {t.count > 0 && (
              <span className={[
                'text-[10px] px-1.5 py-0.5 rounded-full',
                tab === t.key ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500',
              ].join(' ')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 p-8 overflow-y-auto">
        {/* Search */}
        <div className="relative max-w-sm mb-6">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-900/50 border border-white/5 rounded-lg text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-zinc-500">
            <CircleNotch size={18} className="animate-spin" />
            <span className="text-sm">Loading jobs...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="size-14 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center mb-4">
              <ClockCounterClockwise size={24} weight="duotone" className="text-zinc-600" />
            </div>
            <h2 className="text-base font-medium text-zinc-300 mb-1">
              {search.trim() ? 'No matching jobs' : `No ${tab} jobs`}
            </h2>
            <p className="text-sm text-zinc-600 max-w-xs">
              {tab === 'active'
                ? 'No executions are currently running.'
                : tab === 'completed'
                  ? 'No completed executions yet.'
                  : 'No failed executions.'}
            </p>
          </div>
        ) : (
          <div className="border border-white/5 rounded-xl overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_150px_100px_100px_120px_100px] gap-4 px-5 py-3 bg-zinc-900/50 border-b border-white/5">
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Job</span>
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Tool</span>
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Status</span>
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Compute</span>
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Started</span>
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Duration</span>
            </div>

            {/* Table rows */}
            {filtered.map((row) => (
              <button
                key={row.id}
                onClick={() => router.push(`/jobs/${row.id}`)}
                className="w-full grid grid-cols-[1fr_150px_100px_100px_120px_100px] gap-4 px-5 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.02] transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <StatusIcon status={row.status} />
                  <span className="text-sm text-zinc-300 truncate">{getJobName(row)}</span>
                </div>
                <span className="text-sm text-zinc-500 truncate">{row.toolName}</span>
                <div>
                  <StatusBadge status={row.status} />
                </div>
                <span className="text-xs font-mono text-zinc-500 truncate">
                  {row.comfyPort
                    ? instanceLabelByPort.get(row.comfyPort) ?? `:${row.comfyPort}`
                    : '--'}
                </span>
                <span className="text-sm text-zinc-500">{timeAgo(row.createdAt)}</span>
                <span className="text-sm text-zinc-500 font-mono">
                  {formatDuration(row.createdAt, row.completedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  )
}
