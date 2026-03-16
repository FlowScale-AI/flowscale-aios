'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MagnifyingGlass,
  Wrench,
  Plus,
  Trash,
  Compass,
  ArrowRight,
  Download,
  SpinnerGap,
  CheckCircle,
  Spinner,
  WarningCircle,
  ArrowsClockwise,
} from 'phosphor-react'
import { PageTransition, Modal } from '@/components/ui'

type Tab = 'my-tools' | 'available-tools'

interface CustomTool {
  id: string
  name: string
  description: string | null
  engine: string
  status: string
  source: string
  createdAt: number
}

interface CatalogEntry {
  id: string
  name: string
  description: string
  badge: string
}

function CustomToolCard({
  tool,
  onDelete,
  inferenceStatus,
}: {
  tool: CustomTool
  onDelete: () => void
  inferenceStatus?: 'running' | 'starting' | 'stopped'
}) {
  const showInference = tool.engine === 'api' && inferenceStatus

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
          <span className={[
            'text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
            tool.status === 'dev'
              ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              : tool.source === 'registry'
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-violet-400 bg-violet-500/10 border-violet-500/20',
          ].join(' ')}>
            {tool.status === 'dev' ? 'Dev' : tool.source === 'registry' ? 'Official' : tool.source === 'custom' ? 'Custom' : tool.engine === 'comfyui' ? 'ComfyUI' : 'Custom'}
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
        {showInference ? (
          <span className="flex items-center gap-1.5 text-xs">
            {inferenceStatus === 'running' && (
              <><CheckCircle size={12} weight="fill" className="text-emerald-500" />
              <span className="text-emerald-400">Running</span></>
            )}
            {inferenceStatus === 'starting' && (
              <><Spinner size={12} className="text-amber-400 animate-spin" />
              <span className="text-amber-400">Starting…</span></>
            )}
            {inferenceStatus === 'stopped' && (
              <><WarningCircle size={12} weight="fill" className="text-zinc-500" />
              <span className="text-zinc-500">Not running</span></>
            )}
          </span>
        ) : (
          <span className="text-xs text-zinc-600">Click to run</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="text-zinc-600 hover:text-red-400 transition-colors"
          title="Uninstall"
        >
          <Trash size={13} />
        </button>
      </div>
    </div>
  )
}

function CatalogCard({
  entry,
  onInstall,
  installing,
  installed,
}: {
  entry: CatalogEntry
  onInstall: () => void
  installing: boolean
  installed: boolean
}) {
  return (
    <div className="group flex flex-col rounded-xl border border-white/5 bg-[var(--color-background-panel)] hover:border-zinc-700 transition-all duration-150 overflow-hidden">
      <div className="flex flex-col p-4 flex-1">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="size-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
            <Wrench size={16} weight="duotone" className="text-violet-400" />
          </div>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
            {entry.badge}
          </span>
        </div>
        <h3 className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors mb-1">
          {entry.name}
        </h3>
        <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed flex-1">
          {entry.description}
        </p>
      </div>
      <div className="flex items-center justify-end px-4 py-2 border-t border-white/5">
        {installed ? (
          <span className="text-xs text-zinc-500 flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
            Installed
          </span>
        ) : (
          <button
            onClick={onInstall}
            disabled={installing}
            className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {installing ? (
              <SpinnerGap size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            {installing ? 'Installing…' : 'Install'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function ToolsPage() {
  const [tab, setTab] = useState<Tab>('my-tools')
  const [search, setSearch] = useState('')
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<CustomTool | null>(null)
  const queryClient = useQueryClient()

  const { data: myTools = [], refetch: refetchMyTools } = useQuery<CustomTool[]>({
    queryKey: ['custom-tools'],
    queryFn: async () => {
      const res = await fetch('/api/tools')
      if (!res.ok) return []
      return res.json()
    },
  })

  // Fetch official tools from the remote registry
  const { data: registryData } = useQuery<{ registry: CatalogEntry[]; installedPluginIds: string[] }>({
    queryKey: ['tool-plugins'],
    queryFn: async () => {
      const res = await fetch('/api/tool-plugins')
      if (!res.ok) return { registry: [], installedPluginIds: [] }
      const data = await res.json() as { registry: Array<{ id: string; name: string; description: string; badge: string }>; installedPluginIds: string[] }
      return {
        registry: data.registry.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          badge: r.badge ?? 'Local AI',
        })),
        installedPluginIds: data.installedPluginIds,
      }
    },
  })

  const catalogEntries = registryData?.registry ?? []
  const installedPluginIds = new Set(registryData?.installedPluginIds ?? [])
  const installedToolIds = new Set(myTools.map((t) => t.id))

  const filteredMyTools = myTools.filter(
    (t) =>
      !search.trim() ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  const filteredCatalog = catalogEntries.filter(
    (e) =>
      !search.trim() ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase()),
  )


  // Poll inference server status — shown on api-engine tool cards
  const hasApiTools = myTools.some((t) => t.engine === 'api')
  const { data: inferenceStatus } = useQuery<'running' | 'starting' | 'stopped'>({
    queryKey: ['inference-status'],
    queryFn: async () => {
      const res = await fetch('/api/local-inference/status')
      const data = await res.json() as { status?: string; running: boolean }
      return (data.status as 'running' | 'starting' | 'stopped') ?? (data.running ? 'running' : 'stopped')
    },
    enabled: hasApiTools,
    refetchInterval: 3000,
  })

  async function confirmDelete() {
    if (!pendingDelete) return
    await fetch(`/api/tools/${pendingDelete.id}`, { method: 'DELETE' })
    setPendingDelete(null)
    refetchMyTools()
  }

  const [refreshing, setRefreshing] = useState(false)

  async function handleInstall(id: string) {
    setInstalling((prev) => new Set(prev).add(id))
    try {
      await fetch('/api/tool-plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      queryClient.invalidateQueries({ queryKey: ['custom-tools'] })
      queryClient.invalidateQueries({ queryKey: ['tool-plugins'] })
      setTab('my-tools')
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch('/api/tool-plugins/refresh', { method: 'POST' })
      queryClient.invalidateQueries({ queryKey: ['custom-tools'] })
      queryClient.invalidateQueries({ queryKey: ['tool-plugins'] })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Tools</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {myTools.length} {myTools.length === 1 ? 'tool' : 'tools'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
            title="Scan for new plugins"
          >
            <ArrowsClockwise size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <Link
            href="/build-tool"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-100 bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
          >
            <Plus size={14} />
            Build Tool
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-8 pt-5 shrink-0 border-b border-white/5">
        <button
          onClick={() => setTab('my-tools')}
          className={[
            'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2',
            tab === 'my-tools'
              ? 'text-emerald-400 border-emerald-500'
              : 'text-zinc-500 border-transparent hover:text-zinc-300',
          ].join(' ')}
        >
          My Tools
        </button>
        <button
          onClick={() => setTab('available-tools')}
          className={[
            'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2',
            tab === 'available-tools'
              ? 'text-emerald-400 border-emerald-500'
              : 'text-zinc-500 border-transparent hover:text-zinc-300',
          ].join(' ')}
        >
          Available Tools
        </button>
      </div>

      <div className="flex-1 p-8 overflow-y-auto">
        {/* Search */}
        <div className="relative max-w-sm mb-8">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder={tab === 'my-tools' ? 'Search my tools…' : 'Search available tools…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-900/50 border border-white/5 rounded-lg text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>

        {/* My Tools tab */}
        {tab === 'my-tools' && (
          <>
            {myTools.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="size-14 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center mb-4">
                  <Wrench size={24} weight="duotone" className="text-zinc-600" />
                </div>
                <h2 className="text-base font-medium text-zinc-300 mb-1">No tools yet</h2>
                <p className="text-sm text-zinc-600 mb-6 max-w-xs">
                  Install a ready-made tool from the catalogue, or build your own from a ComfyUI workflow.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setTab('available-tools')}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-100 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <Compass size={15} />
                    Explore Tools
                    <ArrowRight size={13} className="text-zinc-400" />
                  </button>
                  <Link
                    href="/build-tool"
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-100 bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
                  >
                    <Plus size={14} />
                    Build Tool
                  </Link>
                </div>
              </div>
            ) : filteredMyTools.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                <Wrench size={32} className="mb-3 opacity-30" />
                <p className="text-sm">No tools match your search</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredMyTools.map((tool) => (
                  <CustomToolCard
                    key={tool.id}
                    tool={tool}
                    onDelete={() => setPendingDelete(tool)}
                    inferenceStatus={tool.engine === 'api' ? inferenceStatus : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Available Tools tab */}
        {tab === 'available-tools' && (
          <>
            {filteredCatalog.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                <Compass size={32} className="mb-3 opacity-30" />
                <p className="text-sm">No tools found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredCatalog.map((entry) => (
                  <CatalogCard
                    key={entry.id}
                    entry={entry}
                    installed={installedPluginIds.has(entry.id) || installedToolIds.has(`${entry.id}-builtin`)}
                    installing={installing.has(entry.id)}
                    onInstall={() => handleInstall(entry.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <Modal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        maxWidth="max-w-sm"
      >
        <div className="text-center">
          <div className="size-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <Trash size={20} className="text-red-400" />
          </div>
          <h3 className="text-base font-semibold text-zinc-100 mb-1">Uninstall tool?</h3>
          <p className="text-sm text-zinc-500 mb-6">
            <span className="text-zinc-300 font-medium">{pendingDelete?.name}</span> will be removed from My Tools. This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setPendingDelete(null)}
              className="flex-1 px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
            >
              Uninstall
            </button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  )
}
