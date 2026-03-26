'use client'

import { useState, useRef, useEffect } from 'react'
import { ArrowsClockwise } from 'phosphor-react'

interface DatasetImage {
  name: string
  caption: string | null
}

interface CaptionEditorProps {
  datasetId: string
  images: DatasetImage[]
  onUpdate: () => void
}

export function CaptionEditor({ datasetId, images, onUpdate }: CaptionEditorProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [localCaptions, setLocalCaptions] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const img of images) {
      map[img.name] = img.caption ?? ''
    }
    return map
  })
  const [saving, setSaving] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)

  const selected = images[selectedIdx]

  // Sync localCaptions when images prop changes (e.g. after auto-captioning)
  useEffect(() => {
    setLocalCaptions((prev) => {
      const next: Record<string, string> = {}
      for (const img of images) {
        const serverCaption = img.caption ?? ''
        const localValue = prev[img.name]
        // If user has edited this caption locally (non-empty), keep their edit.
        // Otherwise use the server value (which includes freshly auto-generated captions).
        next[img.name] = localValue ? localValue : serverCaption
      }
      return next
    })
  }, [images])

  // Scroll selected thumbnail into view
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const thumb = strip.children[selectedIdx] as HTMLElement | undefined
    if (thumb) {
      thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [selectedIdx])

  async function saveCaption(imageName: string, caption: string) {
    setSaving(true)
    try {
      await fetch(`/api/training/datasets/${datasetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captions: [{ imageName, caption }] }),
      })
      onUpdate()
    } finally {
      setSaving(false)
    }
  }

  if (!selected) return null

  return (
    <div className="rounded-lg border border-white/5 bg-[var(--color-background-panel)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h3 className="text-sm font-tech text-zinc-100">Caption Editor</h3>
        <span className="text-xs text-zinc-500 font-mono">
          {selectedIdx + 1} / {images.length}
        </span>
      </div>

      {/* Main area */}
      <div className="flex gap-0 min-h-[360px]">
        {/* Image preview */}
        <div className="flex-1 flex items-center justify-center bg-zinc-950 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/training/datasets/${datasetId}/images/${selected.name}`}
            alt={selected.name}
            className="max-h-[320px] max-w-full object-contain rounded-md"
          />
        </div>

        {/* Caption panel */}
        <div className="w-72 flex flex-col border-l border-white/5 bg-zinc-950/40">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
            <span className="text-[11px] text-zinc-400 font-mono truncate max-w-[160px]" title={selected.name}>
              {selected.name}
            </span>
            <div className="flex items-center gap-1">
              {saving && (
                <span className="text-[10px] text-zinc-500">Saving…</span>
              )}
              {/* Regenerate placeholder */}
              <button
                className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Regenerate caption (coming soon)"
                onClick={() => {/* placeholder */}}
              >
                <ArrowsClockwise size={13} />
              </button>
            </div>
          </div>
          <textarea
            className={[
              'flex-1 resize-none p-3 text-xs text-zinc-200 font-mono leading-relaxed',
              'bg-transparent outline-none focus:bg-zinc-900/30 transition-colors',
              'placeholder:text-zinc-600',
            ].join(' ')}
            placeholder="No caption yet — run auto-caption or type one…"
            value={localCaptions[selected.name] ?? ''}
            onChange={(e) => {
              const val = e.target.value
              setLocalCaptions((prev) => ({ ...prev, [selected.name]: val }))
            }}
            onBlur={() => {
              const caption = localCaptions[selected.name] ?? ''
              saveCaption(selected.name, caption)
            }}
          />
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="border-t border-white/5 bg-zinc-950/60 p-2">
        <div
          ref={stripRef}
          className="flex gap-2 overflow-x-auto scrollbar-hide pb-1"
        >
          {images.map((img, idx) => (
            <button
              key={img.name}
              onClick={() => setSelectedIdx(idx)}
              className={[
                'relative shrink-0 w-14 h-14 rounded-md overflow-hidden border-2 transition-all',
                idx === selectedIdx
                  ? 'border-violet-500 ring-1 ring-violet-500/40'
                  : 'border-white/5 hover:border-white/20',
              ].join(' ')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/training/datasets/${datasetId}/images/${img.name}`}
                alt={img.name}
                className="w-full h-full object-cover"
              />
              {img.caption && (
                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-tl-sm bg-violet-500" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
