'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Plus, Trash, CircleNotch, X } from 'phosphor-react'
import { PageTransition } from '@/components/ui'
import type { DatasetMeta } from '@/lib/training'

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(ts),
  )
}

export default function TrainingPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTrigger, setNewTrigger] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: datasets = [], isLoading } = useQuery<DatasetMeta[]>({
    queryKey: ['training-datasets'],
    queryFn: async () => {
      const res = await fetch('/api/training/datasets')
      if (!res.ok) return []
      return res.json()
    },
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim() || !newTrigger.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/training/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), triggerWord: newTrigger.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `Failed to create dataset (${res.status})`)
      }
      const dataset = (await res.json()) as DatasetMeta
      queryClient.invalidateQueries({ queryKey: ['training-datasets'] })
      setShowCreate(false)
      setNewName('')
      setNewTrigger('')
      router.push(`/training/${dataset.id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create dataset')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingId(id)
    try {
      await fetch(`/api/training/datasets/${id}`, { method: 'DELETE' })
      queryClient.invalidateQueries({ queryKey: ['training-datasets'] })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
            <Brain size={18} weight="duotone" className="text-violet-400" />
          </div>
          <div>
            <h1 className="font-tech text-xl font-semibold text-zinc-100">Training</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              Manage datasets and fine-tune models
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setShowCreate((v) => !v)
            setCreateError(null)
          }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-100 text-black hover:bg-white rounded-lg transition-colors"
        >
          {showCreate ? <X size={14} /> : <Plus size={14} />}
          {showCreate ? 'Cancel' : 'New Dataset'}
        </button>
      </div>

      <div className="flex-1 p-8 overflow-y-auto">
        {/* Inline create form */}
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-6 p-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5"
          >
            <h2 className="font-tech text-sm font-semibold text-zinc-200 mb-4">New Dataset</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Dataset name</label>
                <input
                  type="text"
                  placeholder="e.g. My Character"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  required
                  className="px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Trigger word</label>
                <input
                  type="text"
                  placeholder="e.g. sks person"
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value)}
                  required
                  className="px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
            </div>
            {createError && (
              <p className="text-xs text-red-400 mb-3">{createError}</p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={creating || !newName.trim() || !newTrigger.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-100 text-black hover:bg-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating && <CircleNotch size={13} className="animate-spin" />}
                {creating ? 'Creating…' : 'Create Dataset'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setCreateError(null) }}
                className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
            <CircleNotch size={18} className="animate-spin" />
            <span className="text-sm">Loading datasets…</span>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && datasets.length === 0 && !showCreate && (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-600">
            <Brain size={48} weight="duotone" className="mb-4 opacity-20 text-violet-400" />
            <p className="text-sm font-medium text-zinc-500 mb-1">No datasets yet</p>
            <p className="text-xs text-zinc-600">
              Create a dataset to start collecting training images.
            </p>
          </div>
        )}

        {/* Dataset grid */}
        {!isLoading && datasets.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                onClick={() => router.push(`/training/${dataset.id}`)}
                className="group flex flex-col rounded-xl border border-white/5 bg-[var(--color-background-panel)] hover:border-zinc-700 transition-all duration-150 cursor-pointer overflow-hidden"
              >
                <div className="flex flex-col p-4 flex-1">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="size-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                      <Brain size={14} weight="duotone" className="text-violet-400" />
                    </div>
                    <button
                      onClick={(e) => handleDelete(dataset.id, e)}
                      disabled={deletingId === dataset.id}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all disabled:opacity-50"
                      title="Delete dataset"
                    >
                      {deletingId === dataset.id ? (
                        <CircleNotch size={13} className="animate-spin" />
                      ) : (
                        <Trash size={13} />
                      )}
                    </button>
                  </div>
                  <h3 className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors mb-1 truncate">
                    {dataset.name}
                  </h3>
                  <p className="text-xs text-zinc-500 truncate">
                    Trigger:{' '}
                    <span className="font-mono text-zinc-400">{dataset.triggerWord}</span>
                  </p>
                </div>
                <div className="px-4 py-2 border-t border-white/5">
                  <span className="text-xs text-zinc-600">{formatDate(dataset.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  )
}
