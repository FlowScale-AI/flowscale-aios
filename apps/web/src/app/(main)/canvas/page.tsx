'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Palette, Trash, DotsThree } from 'phosphor-react'
import { getCanvasList } from '@/features/canvases/api/getCanvasList'
import { deleteCanvas } from '@/features/canvases/api/deleteCanvas'
import type { Canvas } from '@/features/canvases/types'
import CreateCanvasModal from '@/features/canvases/components/CreateCanvasModal'
import { PageTransition, LottieSpinner, StaggerGrid, StaggerItem } from '@/components/ui'

function CanvasCard({ canvas, onDelete }: { canvas: Canvas; onDelete: (id: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const updatedAt = canvas.updated_at
    ? new Date(canvas.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <Link
      href={`/canvas/${canvas._id}`}
      className="group relative flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 hover:bg-zinc-900 hover:border-emerald-500/30 hover:shadow-xl hover:shadow-emerald-900/10 hover:-translate-y-1 transition-all duration-200"
    >
      {/* Canvas preview surface */}
      <div
        className="relative h-36 bg-[var(--color-background-canvas)] overflow-hidden bg-grid-pattern"
      >
        {/* Decorative canvas objects */}
        <div className="absolute inset-0 flex items-center justify-center opacity-20">
          <div className="grid grid-cols-2 gap-3">
            <div className="w-16 h-16 rounded-lg bg-emerald-500/30 border border-emerald-500/40" />
            <div className="w-16 h-10 rounded-lg bg-zinc-500/30 border border-zinc-500/40 mt-3" />
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 ml-2" />
            <div className="w-14 h-12 rounded-lg bg-zinc-500/20 border border-zinc-500/30" />
          </div>
        </div>

        {/* Top-right menu button */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.preventDefault(); setMenuOpen(v => !v) }}
            className="p-1.5 rounded-md bg-zinc-900/80 backdrop-blur-md border border-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <DotsThree size={16} weight="bold" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-lg shadow-xl py-1 min-w-[140px] z-10">
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
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#18181b] to-transparent" />
      </div>

      {/* Card footer */}
      <div className="px-4 py-3 flex items-center justify-between gap-2 bg-[#18181b]">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{canvas.name}</p>
          {updatedAt && <p className="text-xs text-zinc-600 mt-0.5 font-mono-custom">Updated {updatedAt}</p>}
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
  const [modalOpen, setModalOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const list = await getCanvasList()
    setCanvases(list)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleModalSuccess = useCallback(async () => {
    const list = await getCanvasList()
    const newest = list[0]
    if (newest) router.push(`/canvas/${newest._id}`)
  }, [router])

  const handleDelete = async (id: string) => {
    await deleteCanvas(id)
    setCanvases(prev => prev.filter(c => c._id !== id))
  }

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Canvas</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Create and manage your generative canvases</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md transition-colors"
        >
          <Plus size={16} />
          New Canvas
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 p-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <LottieSpinner size={24} />
          </div>
        ) : canvases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center mb-4">
              <Palette size={28} className="text-zinc-600" />
            </div>
            <h3 className="font-tech text-base font-medium text-zinc-300 mb-1">No canvases yet</h3>
            <p className="text-sm text-zinc-500 mb-6">Create your first canvas to start generating</p>
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md transition-colors"
            >
              <Plus size={16} />
              Create Canvas
            </button>
          </div>
        ) : (
          <StaggerGrid className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {/* New canvas card */}
            <StaggerItem>
              <button
                onClick={() => setModalOpen(true)}
                className="group flex flex-col rounded-xl overflow-hidden border-2 border-dashed border-zinc-800 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all duration-200 text-zinc-600 hover:text-emerald-400 w-full"
              >
                <div className="h-36 flex items-center justify-center">
                  <Plus size={28} className="transition-transform group-hover:scale-110" />
                </div>
                <div className="px-4 py-3">
                  <p className="text-sm font-medium">New Canvas</p>
                </div>
              </button>
            </StaggerItem>

            {canvases.map(canvas => (
              <StaggerItem key={canvas._id}>
                <CanvasCard canvas={canvas} onDelete={handleDelete} />
              </StaggerItem>
            ))}
          </StaggerGrid>
        )}
      </div>
      <CreateCanvasModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handleModalSuccess}
      />
    </PageTransition>
  )
}
