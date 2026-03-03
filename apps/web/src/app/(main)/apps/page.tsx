'use client'

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AppWindow, ArrowRight, ArrowUpRight, Warning, MagnifyingGlass, Trash } from 'phosphor-react'
import { PageTransition, FadeIn, StaggerGrid, StaggerItem, SkeletonCard, Modal } from '@/components/ui'

interface Tool {
  id: string
  name: string
  description: string | null
  status: string
  schemaJson: string | null
  version: number | null
  deployedAt: number | null
  createdAt: number
}

// ---------------------------------------------------------------------------
// Tool card
// ---------------------------------------------------------------------------

function ToolCard({ tool, onDelete }: { tool: Tool; onDelete: (tool: Tool) => void }) {
  return (
    <div className="group relative h-full">
      <Link
        href={`/apps/${tool.id}`}
        className="block h-full"
      >
        <div className="relative h-full overflow-hidden rounded-lg border border-white/5 bg-[var(--color-background-panel)] p-5 transition-all duration-200 group-hover:border-zinc-700 group-hover:bg-zinc-800/50">
          {/* Content */}
          <div className="relative z-10 flex flex-col gap-3">
            {/* Icon */}
            <div className="flex size-10 items-center justify-center rounded-md border border-white/10 bg-white/5 transition-colors duration-200 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20 group-hover:text-emerald-400 text-zinc-400">
              <AppWindow size={20} weight="duotone" />
            </div>

            {/* Text */}
            <div className="space-y-1.5">
              <h3 className="font-tech text-base font-medium text-zinc-100 group-hover:text-white transition-colors">
                {tool.name}
              </h3>
              <p className="text-sm text-zinc-500 line-clamp-2 leading-relaxed">
                {tool.description || 'No description'}
              </p>
            </div>
          </div>

          {/* Arrow (subtle on hover) */}
          <div className="absolute top-5 right-5 opacity-0 -translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
            <ArrowUpRight size={16} className="text-zinc-400" />
          </div>
        </div>
      </Link>

      {/* Delete button (hover) */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(tool) }}
        className="absolute top-3 right-3 z-20 p-1.5 rounded-md bg-zinc-900/80 border border-white/5 text-zinc-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-950/50 opacity-0 group-hover:opacity-100 transition-all duration-200"
        title="Delete app"
      >
        <Trash size={14} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AppsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Tool | null>(null)
  const [deleting, setDeleting] = useState(false)
  const queryClient = useQueryClient()

  const { data: tools, isLoading, error } = useQuery<Tool[]>({
    queryKey: ['tools', 'production'],
    queryFn: async () => {
      const res = await fetch('/api/tools?status=production')
      if (!res.ok) throw new Error('Failed to fetch tools')
      return res.json()
    },
  })

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await fetch(`/api/tools/${deleteTarget.id}`, { method: 'DELETE' })
      queryClient.invalidateQueries({ queryKey: ['tools'] })
    } catch { /* ignore */ } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const filteredTools = (tools ?? []).filter(
    (tool) =>
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (tool.description ?? '').toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      <div className="flex-1 px-8">
        <div className="space-y-12">

          {/* Hero Section */}
          <FadeIn from="bottom" duration={0.5}>
            <section className="relative flex flex-col items-center justify-center space-y-6 text-center py-16 md:py-24">
              {/* Abstract Background Element */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />

              <div className="relative z-10 space-y-4 max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-emerald-400 backdrop-blur-md">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  System Operational
                </div>

                <h1 className="font-tech text-4xl md:text-6xl font-bold tracking-tight text-white">
                  Access Your{' '}
                  <span className="bg-gradient-to-r from-emerald-400 to-emerald-200 bg-clip-text text-transparent">
                    Creative Intelligence
                  </span>
                </h1>

                <p className="text-zinc-400 text-lg md:text-xl max-w-xl mx-auto">
                  A unified operating system for all your AI tools. Create, analyze, and build faster than ever.
                </p>

                {/* Search Bar */}
                <div className="relative max-w-md mx-auto w-full mt-8 group">
                  <div className="absolute inset-0 bg-emerald-500/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative flex items-center bg-[var(--color-background-panel)] border border-white/10 rounded-xl px-4 py-3 shadow-lg focus-within:border-emerald-500/50 transition-colors">
                    <MagnifyingGlass size={20} className="text-zinc-500 shrink-0" />
                    <input
                      type="text"
                      placeholder="Search apps..."
                      className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-100 placeholder-zinc-600 px-3"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <div className="hidden md:flex items-center gap-1">
                      <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 font-mono-custom text-[10px] font-medium text-zinc-500">
                        <span className="text-xs">&#8984;</span>K
                      </kbd>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </FadeIn>

          {/* Tool Grid Section */}
          <section>
            <FadeIn delay={0.15}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-tech text-2xl font-semibold text-white">
                  Installed Apps
                </h2>
                {!isLoading && !error && (
                  <div className="text-sm text-zinc-500">
                    {filteredTools.length} {filteredTools.length === 1 ? 'app' : 'apps'} available
                  </div>
                )}
              </div>
            </FadeIn>

            {/* Loading */}
            {isLoading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-3 p-4 bg-red-950/30 border border-red-900/50 rounded-lg text-red-400 text-sm">
                <Warning size={16} weight="fill" />
                Failed to load tools. Make sure the server is running.
              </div>
            )}

            {/* Empty state */}
            {!isLoading && !error && tools?.length === 0 && (
              <FadeIn>
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="flex size-16 items-center justify-center rounded-2xl bg-zinc-900 border border-white/5 mb-4">
                    <AppWindow size={28} weight="duotone" className="text-zinc-600" />
                  </div>
                  <h2 className="font-tech text-base font-medium text-zinc-300 mb-2">No tools deployed yet</h2>
                  <p className="text-sm text-zinc-500 mb-6 max-w-xs">
                    Go to Build Tool to create and deploy a ComfyUI workflow as a production tool.
                  </p>
                  <Link
                    href="/build-tool"
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md transition-colors"
                  >
                    Open Build Tool
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </FadeIn>
            )}

            {/* Search no results */}
            {!isLoading && !error && tools && tools.length > 0 && filteredTools.length === 0 && (
              <FadeIn>
                <div className="text-center py-12 text-zinc-500">
                  No tools found matching &lsquo;{searchQuery}&rsquo;
                </div>
              </FadeIn>
            )}

            {/* Grid */}
            {!isLoading && !error && filteredTools.length > 0 && (
              <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredTools.map((tool) => (
                  <StaggerItem key={tool.id}>
                    <ToolCard tool={tool} onDelete={setDeleteTarget} />
                  </StaggerItem>
                ))}
              </StaggerGrid>
            )}
          </section>

        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal isOpen={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} title="Delete App">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Are you sure you want to delete <span className="text-zinc-200 font-medium">{deleteTarget?.name}</span>? This will remove the tool and all its execution history. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-md transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  )
}
