'use client'

import { useQuery } from '@tanstack/react-query'
import { CheckCircle, XCircle, SpinnerGap, FileArrowDown, Clock } from 'phosphor-react'

interface Execution {
  id: string
  status: string
  inputsJson: string
  outputsJson: string | null
  createdAt: number
  completedAt: number | null
}

interface TrainingHistoryProps {
  toolId: string
}

export function TrainingHistory({ toolId }: TrainingHistoryProps) {
  const { data: executions } = useQuery<Execution[]>({
    queryKey: ['training-history', toolId],
    queryFn: async () => {
      const res = await fetch(`/api/tools/${toolId}/executions`)
      if (!res.ok) return []
      return res.json() as Promise<Execution[]>
    },
    refetchInterval: 10_000,
  })

  if (!executions || executions.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3">Training History</h3>
        <p className="text-xs text-zinc-600">No training runs yet</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3">Training History</h3>
      <div className="flex flex-col gap-2">
        {executions.map((exec) => {
          const inputs = JSON.parse(exec.inputsJson) as { outputName?: string; steps?: number }
          const outputs = exec.outputsJson ? JSON.parse(exec.outputsJson) as Array<{ kind?: string; path?: string; filename?: string }> : null
          const outputFile = outputs?.find(o => o.kind === 'file')
          const sampleImage = outputs?.find(o => o.kind === 'image')
          const duration = exec.completedAt && exec.createdAt
            ? Math.round((exec.completedAt - exec.createdAt) / 1000)
            : null

          return (
            <div
              key={exec.id}
              className="rounded-lg border border-white/5 bg-zinc-900/40 overflow-hidden"
            >
              {/* Sample image preview */}
              {sampleImage?.path && (
                <div className="border-b border-white/5">
                  <img
                    src={sampleImage.path}
                    alt={`Sample from ${inputs.outputName ?? 'training'}`}
                    className="w-full h-32 object-cover"
                  />
                </div>
              )}
              <div className="flex items-center gap-3 px-3 py-2.5">
                {/* Status icon */}
                {exec.status === 'completed' && <CheckCircle size={16} weight="fill" className="text-emerald-400 shrink-0" />}
                {exec.status === 'error' && <XCircle size={16} weight="fill" className="text-red-400 shrink-0" />}
                {exec.status === 'running' && <SpinnerGap size={16} className="text-violet-400 animate-spin shrink-0" />}

                {/* Name + details */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-zinc-200 font-mono truncate block">
                    {inputs.outputName ?? exec.id.slice(0, 8)}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5">
                    <span>{inputs.steps ?? '?'} steps</span>
                    {duration !== null && (
                      <>
                        <span className="text-zinc-700">&middot;</span>
                        <span className="flex items-center gap-0.5">
                          <Clock size={10} />
                          {duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m ${duration % 60}s`}
                        </span>
                      </>
                    )}
                    <span className="text-zinc-700">&middot;</span>
                    <span>{new Date(exec.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>

                {/* Download link */}
                {exec.status === 'completed' && outputFile?.path && (
                  <a
                    href={outputFile.path}
                    download={outputFile.filename}
                    className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
                  >
                    <FileArrowDown size={14} />
                    .safetensors
                  </a>
                )}

                {exec.status === 'error' && (
                  <span className="text-xs text-red-400/60 shrink-0">Failed</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
