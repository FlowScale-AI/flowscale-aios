'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowsClockwise, CircleNotch, HardDrive, MagnifyingGlass } from 'phosphor-react'
import { PageTransition } from '@/components/ui'
import type { ModelRow } from '@/lib/db/schema'
import type { ComfyInstance } from '@/app/api/comfy/scan/route'

type ModelType = 'checkpoint' | 'lora' | 'vae' | 'controlnet' | 'upscaler' | 'other'

const TYPE_LABELS: Record<ModelType, string> = {
  checkpoint: 'Checkpoints',
  lora: 'LoRAs',
  vae: 'VAEs',
  controlnet: 'ControlNets',
  upscaler: 'Upscalers',
  other: 'Other',
}

const TYPE_ORDER: ModelType[] = ['checkpoint', 'lora', 'vae', 'controlnet', 'upscaler', 'other']

const TYPE_COLORS: Record<ModelType, string> = {
  checkpoint: 'text-emerald-400 bg-emerald-400/10',
  lora: 'text-violet-400 bg-violet-400/10',
  vae: 'text-sky-400 bg-sky-400/10',
  controlnet: 'text-orange-400 bg-orange-400/10',
  upscaler: 'text-amber-400 bg-amber-400/10',
  other: 'text-zinc-400 bg-zinc-400/10',
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function ModelsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: modelRows = [], isLoading } = useQuery<ModelRow[]>({
    queryKey: ['models'],
    queryFn: async () => {
      const res = await fetch('/api/models')
      if (!res.ok) return []
      return res.json()
    },
  })

  const rescanMutation = useMutation({
    mutationFn: async () => {
      // Get active ComfyUI instances then scan each
      const scanRes = await fetch('/api/comfy/scan')
      const instances = await scanRes.json() as ComfyInstance[]
      await Promise.all(
        instances.map((inst) =>
          fetch('/api/models/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comfyPort: inst.port }),
          }),
        ),
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })

  const filtered = search.trim()
    ? modelRows.filter((m) => m.filename.toLowerCase().includes(search.toLowerCase()))
    : modelRows

  // Group by type in defined order
  const grouped = TYPE_ORDER.map((type) => ({
    type,
    rows: filtered.filter((m) => m.type === type),
  })).filter(({ rows }) => rows.length > 0)

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Models</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {modelRows.length} models indexed across {new Set(modelRows.map((m) => m.comfyPort)).size} ComfyUI instance{new Set(modelRows.map((m) => m.comfyPort)).size !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => rescanMutation.mutate()}
          disabled={rescanMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-50"
        >
          {rescanMutation.isPending
            ? <CircleNotch size={13} className="animate-spin" />
            : <ArrowsClockwise size={13} />}
          Rescan
        </button>
      </div>

      <div className="flex-1 p-8 overflow-y-auto">
        {/* Search */}
        <div className="relative max-w-sm mb-8">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Filter by filename…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-900/50 border border-white/5 rounded-lg text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
            <CircleNotch size={18} className="animate-spin" />
            <span className="text-sm">Loading models…</span>
          </div>
        )}

        {!isLoading && modelRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
            <HardDrive size={40} className="mb-3 opacity-30" />
            <p className="text-sm mb-2">No models indexed yet.</p>
            <p className="text-xs text-zinc-700">Click Rescan with a ComfyUI instance running.</p>
          </div>
        )}

        {grouped.map(({ type, rows }) => (
          <section key={type} className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-tech text-sm font-semibold text-zinc-300">
                {TYPE_LABELS[type]}
              </h2>
              <span className="text-xs text-zinc-600">{rows.length}</span>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {rows.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between px-4 py-3 bg-zinc-900/50 border border-white/5 rounded-lg hover:border-zinc-700/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${TYPE_COLORS[model.type as ModelType]}`}>
                      {TYPE_LABELS[model.type as ModelType]?.slice(0, 4).toUpperCase()}
                    </span>
                    <span className="text-sm text-zinc-200 font-mono-custom truncate">{model.filename}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 ml-4">
                    <span className="text-xs text-zinc-500">{formatBytes(model.sizeBytes)}</span>
                    <span className="text-xs text-zinc-600 font-mono-custom">:{model.comfyPort}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageTransition>
  )
}
