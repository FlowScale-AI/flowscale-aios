'use client'

import { useState } from 'react'
import { SpinnerGap } from 'phosphor-react'

interface CaptionProgressProps {
  datasetId: string
  totalImages: number
  onComplete: () => void
}

export function CaptionProgress({ datasetId, totalImages, onComplete }: CaptionProgressProps) {
  const [mode, setMode] = useState<'detailed' | 'brief'>('detailed')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  async function handleCaption() {
    if (running) return
    setRunning(true)
    setProgress(0)
    setError(null)
    setStatusMessage(null)

    try {
      const res = await fetch(`/api/training/datasets/${datasetId}/caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? 'Captioning failed')
        setRunning(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let captionCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; message?: string }
            if (event.type === 'status') {
              setStatusMessage(event.message ?? null)
            } else if (event.type === 'caption') {
              setStatusMessage(null)
              captionCount++
              setProgress(totalImages > 0 ? Math.min(captionCount / totalImages, 1) : 0)
            } else if (event.type === 'error') {
              setError(event.message ?? 'Captioning error')
            }
          } catch { /* skip malformed */ }
        }
      }

      setProgress(1)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Captioning error')
    } finally {
      setRunning(false)
    }
  }

  const pct = Math.round(progress * 100)

  return (
    <div className="rounded-lg border border-white/5 bg-[var(--color-background-panel)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-tech text-zinc-100">Auto-Caption Images</h3>

        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex rounded-md overflow-hidden border border-white/10 text-xs">
            <button
              onClick={() => setMode('detailed')}
              disabled={running}
              className={[
                'px-3 py-1.5 transition-colors',
                mode === 'detailed'
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200',
                running ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              Detailed
            </button>
            <button
              onClick={() => setMode('brief')}
              disabled={running}
              className={[
                'px-3 py-1.5 transition-colors border-l border-white/10',
                mode === 'brief'
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200',
                running ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              Brief
            </button>
          </div>

          {/* Caption button */}
          <button
            onClick={handleCaption}
            disabled={running || totalImages === 0}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              running || totalImages === 0
                ? 'bg-violet-900/40 text-violet-400/50 cursor-not-allowed'
                : 'bg-violet-600 hover:bg-violet-500 text-white',
            ].join(' ')}
          >
            {running && <SpinnerGap size={14} className="animate-spin" />}
            Auto-Caption All
          </button>
        </div>
      </div>

      {/* Status / Progress */}
      {running && statusMessage && progress === 0 && (
        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
          <SpinnerGap size={12} className="animate-spin text-violet-400" />
          {statusMessage}
        </div>
      )}
      {((!statusMessage && running) || progress > 0) && (
        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
            <span>{running ? 'Captioning…' : 'Done'}</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 font-mono">{error}</p>
      )}
    </div>
  )
}
