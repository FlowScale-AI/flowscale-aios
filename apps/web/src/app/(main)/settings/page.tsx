'use client'

import { useQuery } from '@tanstack/react-query'
import { Monitor, HardDrive, ArrowCounterClockwise, CheckCircle, Warning } from 'phosphor-react'
import { PageTransition, LottieSpinner, StaggerGrid, StaggerItem } from '@/components/ui'

interface ComfyInstance {
  port: number
  systemStats: Record<string, unknown> | null
}

interface RuntimeData {
  comfyInstances: ComfyInstance[]
  timestamp: number
}

function getGpuName(inst: ComfyInstance): string {
  try {
    const gpus = (inst.systemStats as { system?: { gpus?: { name: string }[] } })?.system?.gpus
    if (gpus?.[0]?.name) return gpus[0].name
  } catch { /* ignore */ }
  return 'Unknown GPU'
}

function getVram(inst: ComfyInstance): string | null {
  try {
    const gpus = (inst.systemStats as { system?: { gpus?: { total_vram?: number }[] } })?.system?.gpus
    if (gpus?.[0]?.total_vram) {
      return `${(gpus[0].total_vram / 1024).toFixed(0)} GB VRAM`
    }
  } catch { /* ignore */ }
  return null
}

export default function SettingsPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<RuntimeData>({
    queryKey: ['runtime'],
    queryFn: async () => {
      const res = await fetch('/api/settings/runtime')
      if (!res.ok) throw new Error('Failed to fetch runtime status')
      return res.json()
    },
    refetchInterval: 30_000,
  })

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Settings</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Runtime status and app configuration</p>
        </div>
      </div>

      <div className="flex-1 p-8">
        <div className="max-w-2xl mx-auto">

        {/* Runtime Status */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Monitor size={16} className="text-zinc-400" />
              <h2 className="font-tech text-sm font-semibold text-zinc-200">ComfyUI Instances</h2>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors disabled:opacity-50"
            >
              <ArrowCounterClockwise size={12} className={isFetching ? 'animate-spin' : ''} />
              {isFetching ? 'Scanning…' : 'Refresh'}
            </button>
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <LottieSpinner size={14} />
              Scanning ports 6188-16188...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm p-4 bg-red-950/20 border border-red-900/30 rounded-lg">
              <Warning size={14} weight="fill" />
              Failed to scan for ComfyUI instances.
            </div>
          )}

          {!isLoading && !error && data?.comfyInstances.length === 0 && (
            <div className="flex items-center gap-3 p-4 bg-zinc-900/50 border border-white/5 rounded-lg text-zinc-500 text-sm">
              <Monitor size={16} weight="duotone" />
              No ComfyUI instances detected. Start ComfyUI and click Refresh.
            </div>
          )}

          {!isLoading && !error && data && data.comfyInstances.length > 0 && (
            <StaggerGrid className="flex flex-col gap-2">
              {data.comfyInstances.map((inst) => (
                <StaggerItem key={inst.port}>
                  <div className="flex items-center gap-4 p-4 bg-zinc-900/50 border border-white/5 rounded-lg hover:border-emerald-500/30 transition-all">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <CheckCircle size={14} weight="fill" className="text-emerald-500" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-zinc-200">
                        Port {inst.port}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {getGpuName(inst)}
                        {getVram(inst) && ` · ${getVram(inst)}`}
                      </div>
                    </div>
                    <span className="text-xs font-mono-custom text-zinc-600">
                      localhost:{inst.port}
                    </span>
                  </div>
                </StaggerItem>
              ))}
            </StaggerGrid>
          )}

          {data?.timestamp && (
            <p className="text-xs text-zinc-700 mt-3 font-mono-custom">
              Last scanned {new Date(data.timestamp).toLocaleTimeString()}
            </p>
          )}
        </section>

        {/* Storage */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <HardDrive size={16} className="text-zinc-400" />
            <h2 className="font-tech text-sm font-semibold text-zinc-200">Storage</h2>
          </div>
          <div className="flex flex-col gap-3 p-4 bg-zinc-900/50 border border-white/5 rounded-lg text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Database</span>
              <span className="text-zinc-300 font-mono-custom text-xs">~/.flowscale/eios.db</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Outputs</span>
              <span className="text-zinc-300 font-mono-custom text-xs">~/.flowscale/eios-outputs/</span>
            </div>
          </div>
          <p className="text-xs text-zinc-600 mt-2">
            All data and outputs stay on this machine. Nothing is sent to the cloud.
          </p>
        </section>

        {/* App info */}
        <section className="mt-8 pt-8 border-t border-white/5">
          <div className="flex justify-between text-xs text-zinc-600">
            <span className="font-tech">FlowScale AI OS</span>
            <span className="font-mono-custom">v0.1.0</span>
          </div>
        </section>

        </div>
      </div>
    </PageTransition>
  )
}
