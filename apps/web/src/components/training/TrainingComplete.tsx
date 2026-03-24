'use client'

import { Check, FolderOpen, ArrowCounterClockwise } from 'phosphor-react'

interface TrainingCompleteProps {
  outputName: string
  duration: number
  steps: number
  onRetrain: () => void
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function openFolder() {
  if (typeof window !== 'undefined' && window.desktop) {
    window.desktop.shell.openExternal('file://' + encodeURI(
      (typeof window !== 'undefined' ? (window as Window & typeof globalThis & { __comfyLorasPath?: string }).__comfyLorasPath : undefined) ?? ''
    ))
  }
}

export function TrainingComplete({ outputName, duration, steps, onRetrain }: TrainingCompleteProps) {
  const filename = `${outputName}.safetensors`

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {/* Success icon */}
      <div className="flex size-16 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
        <Check size={32} weight="bold" className="text-emerald-400" />
      </div>

      {/* Title + summary */}
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h3 className="font-tech text-lg font-semibold text-zinc-100">Training Complete</h3>
        <p className="text-sm text-zinc-500">
          Trained for <span className="text-zinc-300">{steps.toLocaleString()} steps</span> in{' '}
          <span className="text-zinc-300">{formatDuration(duration)}</span>
        </p>
      </div>

      {/* Output file card */}
      <div className="w-full rounded-lg border border-white/5 bg-zinc-900/60 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Output File</span>
          <span className="font-mono text-sm text-zinc-200 break-all">{filename}</span>
          <span className="text-xs text-zinc-500 mt-1">Saved to ComfyUI loras/</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex w-full gap-3">
        <button
          type="button"
          onClick={openFolder}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          <FolderOpen size={15} />
          Open folder
        </button>
        <button
          type="button"
          onClick={onRetrain}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          <ArrowCounterClockwise size={15} />
          Train again
        </button>
      </div>
    </div>
  )
}
