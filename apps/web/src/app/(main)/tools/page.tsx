'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  MagnifyingGlass,
  Wrench,
  Plus,
  Trash,
} from 'phosphor-react'
import { PageTransition } from '@/components/ui'

interface CustomTool {
  id: string
  name: string
  description: string | null
  engine: string
  status: string
  createdAt: number
}

function CustomToolCard({
  tool,
  onDelete,
}: {
  tool: CustomTool
  onDelete: () => void
}) {
  return (
    <div className="group flex flex-col rounded-xl border border-white/5 bg-[var(--color-background-panel)] hover:border-zinc-700 transition-all duration-150 relative overflow-hidden">
      <Link href={`/tools/${tool.id}`} className="flex flex-col p-4 flex-1">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="size-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0 overflow-hidden">
            {tool.engine === 'comfyui' ? (
              <img src="/comfyui-logo.png" alt="ComfyUI" className="size-5 object-contain" />
            ) : (
              <Wrench size={16} weight="duotone" className="text-violet-400" />
            )}
          </div>
          <span className="text-[10px] font-semibold text-violet-400 px-1.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20">
            Custom
          </span>
        </div>
        <h3 className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors mb-1">
          {tool.name}
        </h3>
        <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
          {tool.description ?? 'No description'}
        </p>
      </Link>
      <div className="flex items-center justify-between px-4 py-2 border-t border-white/5">
        <span className="text-xs text-zinc-600">Click to run</span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="text-zinc-600 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash size={13} />
        </button>
      </div>
    </div>
  )
}

export default function ToolsPage() {
  const [search, setSearch] = useState('')

  const { data: customTools = [], refetch: refetchCustom } = useQuery<CustomTool[]>({
    queryKey: ['custom-tools'],
    queryFn: async () => {
      const res = await fetch('/api/tools?status=production')
      if (!res.ok) return []
      return res.json()
    },
  })

  const filteredTools = customTools.filter((t) =>
    !search.trim() ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  async function handleDeleteCustom(id: string) {
    await fetch(`/api/tools/${id}`, { method: 'DELETE' })
    refetchCustom()
  }

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Tools</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {customTools.length} custom tools
          </p>
        </div>
        <Link
          href="/build-tool"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-100 bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
        >
          <Plus size={14} />
          Build Tool
        </Link>
      </div>

      <div className="flex-1 p-8 overflow-y-auto">

        {/* Search */}
        <div className="relative max-w-sm mb-8">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search tools…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-900/50 border border-white/5 rounded-lg text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>

        {/* Tools */}
        {filteredTools.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
            <Wrench size={32} className="mb-3 opacity-30" />
            <p className="text-sm">{customTools.length === 0 ? 'No tools yet — build one!' : 'No tools match your search'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredTools.map((tool) => (
              <CustomToolCard
                key={tool.id}
                tool={tool}
                onDelete={() => handleDeleteCustom(tool.id)}
              />
            ))}
          </div>
        )}
      </div>

    </PageTransition>
  )
}
