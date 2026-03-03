'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Palette, Trash, DotsThree } from 'phosphor-react'
import { localGetCanvasList, localCreateCanvas, localDeleteCanvas } from '@/lib/local-db'
import type { Canvas } from '@/features/canvases/types'

function CanvasCard({ canvas, onDelete }: { canvas: Canvas; onDelete: (id: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const updatedAt = canvas.updated_at
    ? new Date(canvas.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <Link
      href={`/canvas/${canvas._id}`}
      className="group relative flex flex-col rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 hover:border-zinc-600 transition-all duration-200 hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-0.5"
    >
      {/* Canvas preview surface */}
      <div
        className="relative h-44 bg-[#0d0d0d] overflow-hidden"
        style={{
          backgroundImage: 'radial-gradient(circle, #2a2a2a 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        {/* Decorative canvas objects */}
        <div className="absolute inset-0 flex items-center justify-center opacity-20">
          <div className="grid grid-cols-2 gap-3">
            <div className="w-16 h-16 rounded-lg bg-indigo-500/30 border border-indigo-500/40" />
            <div className="w-16 h-10 rounded-lg bg-emerald-500/30 border border-emerald-500/40 mt-3" />
            <div className="w-10 h-10 rounded-full bg-violet-500/30 border border-violet-500/40 ml-2" />
            <div className="w-14 h-12 rounded-lg bg-amber-500/30 border border-amber-500/40" />
          </div>
        </div>

        {/* Top-right menu button */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.preventDefault(); setMenuOpen(v => !v) }}
            className="p-1.5 rounded-lg bg-zinc-900/80 border border-zinc-700 text-zinc-400 hover:text-white transition-colors"
          >
            <DotsThree size={16} weight="bold" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[140px] z-10">
              <button
                onClick={(e) => { e.preventDefault(); onDelete(canvas._id); setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash size={14} />
                Delete canvas
              </button>
            </div>
          )}
        </div>

        {/* Subtle gradient overlay at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-zinc-900 to-transparent" />
      </div>

      {/* Card footer */}
      <div className="px-4 py-3 flex items-center justify-between gap-2 bg-zinc-900">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{canvas.name}</p>
          {updatedAt && <p className="text-xs text-zinc-500 mt-0.5">Updated {updatedAt}</p>}
        </div>
        <Palette size={16} className="text-zinc-600 shrink-0" />
      </div>
    </Link>
  )
}

export default function CanvasListPage() {
  const router = useRouter()
  const [canvases, setCanvases] = useState<Canvas[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const list = await localGetCanvasList()
    setCanvases(list)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setCreating(true)
    const canvas = await localCreateCanvas({ name: `Canvas ${canvases.length + 1}` })
    router.push(`/canvas/${canvas._id}`)
  }

  const handleDelete = async (id: string) => {
    await localDeleteCanvas(id)
    setCanvases(prev => prev.filter(c => c._id !== id))
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-zinc-800 shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Canvas</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Create and manage your generative canvases</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Canvas
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 p-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : canvases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
              <Palette size={28} className="text-zinc-600" />
            </div>
            <h3 className="text-base font-medium text-zinc-300 mb-1">No canvases yet</h3>
            <p className="text-sm text-zinc-500 mb-6">Create your first canvas to start generating</p>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={16} />
              Create Canvas
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {/* New canvas card */}
            <button
              onClick={handleCreate}
              disabled={creating}
              className="group flex flex-col items-center justify-center h-[232px] rounded-xl border-2 border-dashed border-zinc-800 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all duration-200 text-zinc-600 hover:text-indigo-400 disabled:opacity-50"
            >
              <Plus size={24} className="mb-2 transition-transform group-hover:scale-110" />
              <span className="text-sm font-medium">New Canvas</span>
            </button>

            {canvases.map(canvas => (
              <CanvasCard key={canvas._id} canvas={canvas} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
