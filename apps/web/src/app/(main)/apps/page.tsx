'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AppWindow, ArrowRight, Clock, CheckCircle, Warning } from 'phosphor-react'

interface Tool {
  id: string
  name: string
  description: string | null
  status: string
  version: number | null
  deployedAt: number | null
  createdAt: number
}

function ToolCard({ tool }: { tool: Tool }) {
  const deployedDate = tool.deployedAt
    ? new Date(tool.deployedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <Link
      href={`/apps/${tool.id}`}
      className="group flex flex-col gap-3 p-5 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-600 hover:bg-zinc-800/50 transition-all duration-150"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center shrink-0">
            <AppWindow size={18} weight="duotone" className="text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white transition-colors">
              {tool.name}
            </h3>
            {tool.version && (
              <span className="text-xs text-zinc-500">v{tool.version}</span>
            )}
          </div>
        </div>
        <ArrowRight
          size={16}
          className="text-zinc-600 group-hover:text-zinc-400 transition-colors mt-1 shrink-0"
        />
      </div>

      {tool.description && (
        <p className="text-sm text-zinc-400 line-clamp-2">{tool.description}</p>
      )}

      <div className="flex items-center gap-4 mt-auto pt-2 border-t border-zinc-800">
        <div className="flex items-center gap-1.5">
          <CheckCircle size={13} weight="fill" className="text-emerald-500" />
          <span className="text-xs text-zinc-500">Production</span>
        </div>
        {deployedDate && (
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-zinc-600" />
            <span className="text-xs text-zinc-500">Deployed {deployedDate}</span>
          </div>
        )}
      </div>
    </Link>
  )
}

export default function AppsPage() {
  const { data: tools, isLoading, error } = useQuery<Tool[]>({
    queryKey: ['tools', 'production'],
    queryFn: async () => {
      const res = await fetch('/api/tools?status=production')
      if (!res.ok) throw new Error('Failed to fetch tools')
      return res.json()
    },
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Apps</h1>
            <p className="text-sm text-zinc-500 mt-1">Your deployed production tools</p>
          </div>
          <Link
            href="/build-tool"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + New Tool
          </Link>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-950/30 border border-red-900/50 rounded-xl text-red-400 text-sm">
            <Warning size={16} weight="fill" />
            Failed to load tools. Make sure the server is running.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && tools?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mb-4">
              <AppWindow size={28} weight="duotone" className="text-zinc-500" />
            </div>
            <h2 className="text-base font-medium text-zinc-300 mb-2">No tools deployed yet</h2>
            <p className="text-sm text-zinc-500 mb-6 max-w-xs">
              Go to Build Tool to create and deploy a ComfyUI workflow as a production tool.
            </p>
            <Link
              href="/build-tool"
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Open Build Tool
              <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {/* Grid */}
        {!isLoading && !error && tools && tools.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
