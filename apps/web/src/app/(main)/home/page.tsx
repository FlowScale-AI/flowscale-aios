'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Palette,
  Cube,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  CircleNotch,
  Lightning,
  Storefront,
} from 'phosphor-react'
import { PageTransition } from '@/components/ui'
import type { AppManifest } from '@/lib/appManifest'

interface InstalledAppRow {
  id: string
  displayName: string
  source: string
  manifest: AppManifest | null
}

interface Execution {
  id: string
  toolId: string
  status: 'running' | 'completed' | 'error'
  createdAt: number
  completedAt: number | null
}

interface ComfyInstance {
  port: number
  systemStats: Record<string, unknown> | null
}

interface ProviderStatus {
  name: string
  label: string
  configured: boolean
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export default function HomePage() {
  const router = useRouter()

  const { data: installedApps = [] } = useQuery<InstalledAppRow[]>({
    queryKey: ['installed-apps'],
    queryFn: async () => {
      const res = await fetch('/api/apps')
      if (!res.ok) return []
      return res.json()
    },
    staleTime: 30_000,
  })

  const { data: executions = [] } = useQuery<Execution[]>({
    queryKey: ['recent-executions'],
    queryFn: async () => {
      const res = await fetch('/api/executions?limit=8')
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: 15_000,
  })

  const { data: comfyInstances = [] } = useQuery<ComfyInstance[]>({
    queryKey: ['comfy-instances'],
    queryFn: async () => {
      const res = await fetch('/api/comfy/scan')
      if (!res.ok) return []
      return res.json()
    },
    staleTime: 60_000,
  })

  const { data: providers = [] } = useQuery<ProviderStatus[]>({
    queryKey: ['providers'],
    queryFn: async () => {
      const res = await fetch('/api/providers')
      if (!res.ok) return []
      return res.json()
    },
    staleTime: 30_000,
  })

  const mainApps = installedApps.filter(
    (app) => app.manifest?.capabilities?.slots?.includes('main-app'),
  )

  const configuredProviders = providers.filter((p) => p.configured)

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      <div className="flex-1 px-8 py-8 max-w-5xl w-full mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="font-tech text-2xl font-semibold text-zinc-100">Home</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Your workspace at a glance</p>
        </div>

        {/* Quick Access */}
        <section className="mb-10">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Quick Access</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">

            {/* Canvas — always first */}
            <Link
              href="/canvas"
              className="group flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)] hover:border-zinc-700 hover:bg-zinc-800/50 transition-all duration-150 text-center"
            >
              <div className="size-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/15 transition-colors">
                <Palette size={22} weight="duotone" className="text-emerald-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">Canvas</div>
                <div className="text-xs text-zinc-600">Built-in</div>
              </div>
            </Link>

            {/* Installed third-party apps */}
            {mainApps.map((app) => (
              <Link
                key={app.id}
                href={`/installed-apps/${app.id}`}
                className="group flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/5 bg-[var(--color-background-panel)] hover:border-zinc-700 hover:bg-zinc-800/50 transition-all duration-150 text-center"
              >
                <div className="size-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center group-hover:bg-violet-500/15 transition-colors">
                  <Cube size={22} weight="duotone" className="text-violet-400" />
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors truncate max-w-[100px]">{app.displayName}</div>
                  {app.source === 'sideloaded' && (
                    <div className="text-[10px] text-amber-500/70 font-semibold uppercase tracking-wider">Dev</div>
                  )}
                </div>
              </Link>
            ))}

            {/* Install More */}
            <Link
              href="/explore"
              className="group flex flex-col items-center gap-2.5 p-4 rounded-xl border border-dashed border-white/10 hover:border-zinc-600 transition-all duration-150 text-center"
            >
              <div className="size-12 rounded-xl bg-zinc-800/50 flex items-center justify-center group-hover:bg-zinc-700/50 transition-colors">
                <Plus size={20} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
              </div>
              <div className="text-sm font-medium text-zinc-600 group-hover:text-zinc-400 transition-colors">Install More</div>
            </Link>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Recent Activity */}
          <section>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Recent Activity</h2>
            <div className="rounded-xl border border-white/5 bg-[var(--color-background-panel)] divide-y divide-white/5">
              {executions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-zinc-600">
                  <Clock size={28} className="mb-2 opacity-40" />
                  <p className="text-sm">No activity yet</p>
                  <p className="text-xs text-zinc-700 mt-1">Run a tool to see activity here</p>
                </div>
              )}
              {executions.map((exec) => (
                <div key={exec.id} className="flex items-center gap-3 px-4 py-3">
                  {exec.status === 'completed' && <CheckCircle size={15} weight="fill" className="text-emerald-500 shrink-0" />}
                  {exec.status === 'error' && <XCircle size={15} weight="fill" className="text-red-500 shrink-0" />}
                  {exec.status === 'running' && <CircleNotch size={15} className="text-zinc-500 animate-spin shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-300 truncate font-mono-custom text-xs">{exec.toolId}</p>
                  </div>
                  <span className="text-xs text-zinc-600 shrink-0">{timeAgo(exec.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* System Status */}
          <section>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">System Status</h2>
            <div className="rounded-xl border border-white/5 bg-[var(--color-background-panel)] divide-y divide-white/5">

              {/* ComfyUI */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <img src="/comfyui-logo.png" alt="ComfyUI" className="size-4 object-contain" />
                    <span className="text-sm text-zinc-300">ComfyUI</span>
                  </div>
                  {comfyInstances.length > 0 ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {comfyInstances.length === 1
                        ? `Connected (port ${comfyInstances[0].port})`
                        : `${comfyInstances.length} instances`}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-600">Not running</span>
                  )}
                </div>
              </div>

              {/* Providers */}
              {providers.map((provider) => (
                <div key={provider.name} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-zinc-300">{provider.label}</span>
                  {provider.configured ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                      Configured
                    </span>
                  ) : (
                    <button
                      onClick={() => router.push('/providers')}
                      className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      Not set up →
                    </button>
                  )}
                </div>
              ))}

              {providers.length === 0 && comfyInstances.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-zinc-600 gap-2">
                  <Lightning size={24} className="opacity-40" />
                  <p className="text-sm">No infrastructure configured</p>
                  <Link href="/providers" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                    Set up providers →
                  </Link>
                </div>
              )}
            </div>

            {configuredProviders.length > 0 || comfyInstances.length > 0 ? (
              <Link
                href="/providers"
                className="flex items-center gap-1.5 mt-3 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <Storefront size={12} />
                Manage providers
              </Link>
            ) : null}
          </section>
        </div>
      </div>
    </PageTransition>
  )
}
