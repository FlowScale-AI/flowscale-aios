'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Compass, ArrowUpRight, Download, Warning } from 'phosphor-react'
import { PageTransition, FadeIn } from '@/components/ui'
import InstallModal from '@/components/InstallModal'
import type { AppRegistryEntry } from '@/lib/registry/appRegistry'
import type { InstalledApp } from '@/lib/db/schema'

const CATEGORY_COLORS: Record<string, string> = {
  creative: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  production: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  utility: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  research: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
}

export default function ExplorePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [installTarget, setInstallTarget] = useState<AppRegistryEntry | null>(null)

  const { data: registry = [] } = useQuery<AppRegistryEntry[]>({
    queryKey: ['app-registry'],
    queryFn: async () => {
      const res = await fetch('/api/apps/registry')
      if (!res.ok) return []
      return res.json()
    },
  })

  const { data: installedApps = [] } = useQuery<InstalledApp[]>({
    queryKey: ['installed-apps'],
    queryFn: async () => {
      const res = await fetch('/api/apps')
      if (!res.ok) return []
      return res.json()
    },
  })

  const { data: comfyPathData } = useQuery<{ comfyuiPath: string | null }>({
    queryKey: ['comfyui-path'],
    queryFn: async () => {
      const res = await fetch('/api/settings/comfyui-path')
      if (!res.ok) return { comfyuiPath: null }
      return res.json()
    },
  })

  const comfyuiPathSet = !!comfyPathData?.comfyuiPath
  const installedSet = new Set(installedApps.map((a) => a.id))

  // Group by category
  const categories = [...new Set(registry.map((e) => e.category))]

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      <div className="flex-1 px-8 py-10">
        <FadeIn from="bottom" duration={0.4}>
          <div className="mb-10">
            <h1 className="font-tech text-3xl font-bold text-white mb-2">App Store</h1>
            <p className="text-zinc-400 text-base">Browse and install apps for FlowScale.</p>
          </div>
        </FadeIn>

        {categories.map((category, i) => (
          <FadeIn key={category} delay={0.05 * (i + 1)}>
            <div className="mb-10">
              <h2 className="font-tech text-lg font-semibold text-zinc-300 mb-4 capitalize">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {registry
                  .filter((e) => e.category === category)
                  .map((entry) => {
                    const installed = installedSet.has(entry.id)
                    const colorClass = CATEGORY_COLORS[entry.category] ?? CATEGORY_COLORS.utility

                    return (
                      <div
                        key={entry.id}
                        className="group relative overflow-hidden rounded-xl border border-white/5 bg-[var(--color-background-panel)] p-6 transition-all duration-200 hover:border-zinc-700/70"
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <div className={`size-9 rounded-lg border flex items-center justify-center shrink-0 ${colorClass}`}>
                            <Compass size={18} weight="duotone" />
                          </div>
                          {installed && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
                              installed
                            </span>
                          )}
                        </div>

                        <h3 className="font-tech text-sm font-semibold text-zinc-200 mb-1.5 group-hover:text-white transition-colors">
                          {entry.displayName}
                        </h3>
                        <p className="text-xs text-zinc-500 leading-relaxed mb-4">{entry.description}</p>

                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">
                            {entry.author}
                          </span>

                          {installed ? (
                            <button
                              onClick={() => router.push(`/installed-apps/${entry.id}`)}
                              className="flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                            >
                              Open <ArrowUpRight size={11} />
                            </button>
                          ) : comfyuiPathSet ? (
                            <button
                              onClick={() => setInstallTarget(entry)}
                              className="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                            >
                              <Download size={11} /> Install
                            </button>
                          ) : (
                            <span
                              title="Set ComfyUI installation path in Providers first"
                              className="flex items-center gap-1 text-xs text-zinc-600 cursor-not-allowed"
                            >
                              <Warning size={11} className="text-amber-600" /> Set up ComfyUI path
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </FadeIn>
        ))}

        {registry.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
            <Compass size={40} className="mb-3 opacity-30" />
            <p className="text-sm">No apps in the registry yet.</p>
          </div>
        )}
      </div>

      {installTarget && (
        <InstallModal
          entry={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={(appId) => {
            queryClient.invalidateQueries({ queryKey: ['installed-apps'] })
            router.push(`/installed-apps/${appId}`)
          }}
        />
      )}
    </PageTransition>
  )
}
