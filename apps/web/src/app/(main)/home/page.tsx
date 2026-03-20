'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Lightning,
  Cpu,
  Clock,
  CheckCircle,
  XCircle,
  CircleNotch,
  Wrench,
  ArrowSquareOut,
  CaretRight,
} from 'phosphor-react'
import { PageTransition } from '@/components/ui'

interface GpuInfo {
  index: number
  name: string
  vramMB: number
  backend: 'cuda' | 'rocm'
}

interface CpuInfo {
  model: string
  cores: number
  threads: number
  ramGB: number
}

interface ComfyManagedInstance {
  id: string
  status: 'running' | 'starting' | 'stopped'
  port: number
  device: string
  label: string
}

interface StatsData {
  runningJobs: number
  completedJobs: number
  failedJobs: number
  toolsInstalled: number
  modelsAvailable: number
}

interface Execution {
  id: string
  toolId: string
  toolName?: string
  status: 'running' | 'completed' | 'error'
  createdAt: number
  completedAt: number | null
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

interface GpuUtilization {
  index: number
  vramUsedMB: number
  vramTotalMB: number
  gpuUtil: number
}

function VramBar({ vramMB, utilization }: { vramMB: number; utilization?: GpuUtilization }) {
  const totalGB = (vramMB / 1024).toFixed(0)
  if (utilization) {
    const usedGB = (utilization.vramUsedMB / 1024).toFixed(1)
    const totalGBLive = (utilization.vramTotalMB / 1024).toFixed(0)
    const pct = utilization.vramTotalMB > 0 ? Math.round((utilization.vramUsedMB / utilization.vramTotalMB) * 100) : 0
    return (
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500/70' : pct > 70 ? 'bg-amber-500/60' : 'bg-emerald-500/60'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-zinc-500">{usedGB}/{totalGBLive} GB</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-600">GPU {utilization.gpuUtil}%</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: '0%' }} />
      </div>
      <span className="text-[10px] font-mono text-zinc-500">{totalGB} GB</span>
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()

  const { data: gpuData } = useQuery<{ gpus: GpuInfo[]; cpu: CpuInfo }>({
    queryKey: ['gpu-detect'],
    queryFn: async () => {
      const res = await fetch('/api/gpu')
      if (!res.ok) return { gpus: [], cpu: null }
      return res.json()
    },
    staleTime: 60_000,
  })

  const { data: gpuUtilization = [] } = useQuery<GpuUtilization[]>({
    queryKey: ['gpu-utilization'],
    queryFn: async () => {
      const res = await fetch('/api/gpu/utilization')
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: 5000,
  })

  const { data: comfyManage } = useQuery<{ instances: ComfyManagedInstance[] }>({
    queryKey: ['comfy-manage'],
    queryFn: async () => {
      const res = await fetch('/api/comfy/manage')
      if (!res.ok) return { instances: [] }
      return res.json()
    },
    refetchInterval: 10_000,
  })

  const { data: stats } = useQuery<StatsData>({
    queryKey: ['stats'],
    queryFn: async () => {
      const res = await fetch('/api/stats')
      if (!res.ok) return { runningJobs: 0, completedJobs: 0, failedJobs: 0, toolsInstalled: 0, modelsAvailable: 0 }
      return res.json()
    },
    refetchInterval: 10_000,
  })

  const { data: executions = [] } = useQuery<Execution[]>({
    queryKey: ['recent-executions'],
    queryFn: async () => {
      const res = await fetch('/api/executions?limit=10')
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: 10_000,
  })

  const gpus = gpuData?.gpus ?? []
  const cpuInfo = gpuData?.cpu
  const instances = comfyManage?.instances ?? []
  const firstRunningInstance = instances.find(i => i.status === 'running')

  // Map instance status to GPU
  function getGpuStatus(gpuIndex: number) {
    const inst = instances.find(i => i.device === `cuda:${gpuIndex}` || i.device === `rocm:${gpuIndex}`)
    return inst?.status ?? 'stopped'
  }

  function getCpuStatus() {
    const inst = instances.find(i => i.device === 'cpu')
    return inst?.status ?? 'stopped'
  }

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      <div className="flex-1 px-8 py-8 max-w-6xl w-full mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="font-tech text-2xl font-semibold text-zinc-100">Home</h1>
          <p className="text-sm text-zinc-500 mt-0.5">System overview and recent activity</p>
        </div>

        {/* GPU Pool Cards */}
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">GPU Pool</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {gpus.map((gpu) => {
              const status = getGpuStatus(gpu.index)
              return (
                <div key={gpu.index} className="p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)]">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Lightning size={16} className="text-emerald-400" />
                      <span className="text-sm font-medium text-zinc-200">GPU {gpu.index}</span>
                    </div>
                    {status === 'running' ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/20">
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Running
                      </span>
                    ) : status === 'starting' ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 bg-amber-400/10 rounded-full border border-amber-400/20">
                        <CircleNotch size={9} className="animate-spin" />
                        Starting
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 bg-zinc-800 rounded-full">
                        Idle
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 truncate">{gpu.name}</p>
                  <VramBar vramMB={gpu.vramMB} utilization={gpuUtilization.find(u => u.index === gpu.index)} />
                </div>
              )
            })}

            {/* CPU Card */}
            {cpuInfo && (
              <div className="p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)]">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu size={16} className="text-zinc-500" />
                    <span className="text-sm font-medium text-zinc-200">CPU</span>
                  </div>
                  {getCpuStatus() === 'running' ? (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/20">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Running
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 bg-zinc-800 rounded-full">
                      Idle
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 mt-1 truncate">{cpuInfo.model}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] font-mono text-zinc-500">{cpuInfo.cores}C/{cpuInfo.threads}T</span>
                  <span className="text-[10px] font-mono text-zinc-600">·</span>
                  <span className="text-[10px] font-mono text-zinc-500">{cpuInfo.ramGB} GB RAM</span>
                </div>
              </div>
            )}

            {gpus.length === 0 && !cpuInfo && (
              <div className="col-span-full flex flex-col items-center justify-center py-8 text-zinc-600">
                <Lightning size={24} className="opacity-40 mb-2" />
                <p className="text-sm">No devices detected</p>
                <Link href="/settings" className="text-xs text-zinc-500 hover:text-zinc-300 mt-1 transition-colors">
                  Configure compute →
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* Quick Stats */}
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Overview</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)]">
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Running</p>
              <p className="text-2xl font-tech font-semibold text-zinc-100 mt-1">{stats?.runningJobs ?? 0}</p>
            </div>
            <div className="p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)]">
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Completed</p>
              <p className="text-2xl font-tech font-semibold text-zinc-100 mt-1">{stats?.completedJobs ?? 0}</p>
            </div>
            <div className="p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)]">
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Tools</p>
              <p className="text-2xl font-tech font-semibold text-zinc-100 mt-1">{stats?.toolsInstalled ?? 0}</p>
            </div>
            <div className="p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)]">
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Models</p>
              <p className="text-2xl font-tech font-semibold text-zinc-100 mt-1">{stats?.modelsAvailable ?? 0}</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Activity */}
          <section className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Recent Activity</h2>
              <Link href="/jobs" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1">
                View all <CaretRight size={10} />
              </Link>
            </div>
            <div className="rounded-xl border border-white/5 bg-[var(--color-background-panel)] divide-y divide-white/5">
              {executions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-zinc-600">
                  <Clock size={28} className="mb-2 opacity-40" />
                  <p className="text-sm">No activity yet</p>
                  <p className="text-xs text-zinc-700 mt-1">Run a tool to see activity here</p>
                </div>
              )}
              {executions.map((exec) => (
                <Link
                  key={exec.id}
                  href="/jobs"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
                >
                  {exec.status === 'completed' && <CheckCircle size={15} weight="fill" className="text-emerald-500 shrink-0" />}
                  {exec.status === 'error' && <XCircle size={15} weight="fill" className="text-red-500 shrink-0" />}
                  {exec.status === 'running' && <CircleNotch size={15} className="text-amber-400 animate-spin shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-300 truncate">{exec.toolName ?? exec.toolId}</p>
                  </div>
                  <span className="text-xs text-zinc-600 shrink-0">{timeAgo(exec.createdAt)}</span>
                </Link>
              ))}
            </div>
          </section>

          {/* Quick Actions */}
          <section>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Quick Actions</h2>
            <div className="space-y-3">
              {firstRunningInstance && (
                <button
                  onClick={() => window.open(`http://127.0.0.1:${firstRunningInstance.port}`, '_blank')}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)] hover:border-zinc-700 hover:bg-zinc-800/50 transition-all text-left"
                >
                  <div className="size-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    <ArrowSquareOut size={18} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Open ComfyUI</p>
                    <p className="text-xs text-zinc-600">Port {firstRunningInstance.port}</p>
                  </div>
                </button>
              )}
              <Link
                href="/tools"
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)] hover:border-zinc-700 hover:bg-zinc-800/50 transition-all"
              >
                <div className="size-10 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0">
                  <Wrench size={18} className="text-zinc-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200">Browse Tools</p>
                  <p className="text-xs text-zinc-600">Install, build, and manage</p>
                </div>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </PageTransition>
  )
}
