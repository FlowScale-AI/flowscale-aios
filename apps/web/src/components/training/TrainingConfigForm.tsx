'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SpinnerGap, WarningCircle } from 'phosphor-react'

interface DatasetMeta {
  id: string
  name: string
  triggerWord: string
  createdAt: number
}

interface TrainingConfigFormProps {
  toolId: string
  defaultModel: 'flux-dev' | 'sdxl'
  onStart: (executionId: string, jobId: string, meta: { outputName: string; steps: number }) => void
}

const LORA_RANKS = [16, 32, 64, 128, 256] as const

export function TrainingConfigForm({ toolId, defaultModel, onStart }: TrainingConfigFormProps) {
  const defaultSteps = defaultModel === 'flux-dev' ? 1000 : 800

  const [outputName, setOutputName] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [triggerWord, setTriggerWord] = useState('')
  const [steps, setSteps] = useState(defaultSteps)
  const [learningRate, setLearningRate] = useState('1e-4')
  const [loraRank, setLoraRank] = useState<number>(128)
  const [resolution, setResolution] = useState(1024)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: datasets = [], isLoading: datasetsLoading } = useQuery<DatasetMeta[]>({
    queryKey: ['training-datasets'],
    queryFn: async () => {
      const res = await fetch('/api/training/datasets')
      if (!res.ok) throw new Error('Failed to fetch datasets')
      return res.json() as Promise<DatasetMeta[]>
    },
  })

  // Auto-fill trigger word when dataset is selected
  useEffect(() => {
    if (!datasetId) return
    const selected = datasets.find((d) => d.id === datasetId)
    if (selected) setTriggerWord(selected.triggerWord)
  }, [datasetId, datasets])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch(`/api/tools/${toolId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: {
            outputName,
            datasetId,
            triggerWord,
            steps,
            learningRate: parseFloat(learningRate),
            loraRank,
            resolution,
          },
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const data = await res.json() as { id: string; jobId?: string }
      onStart(data.id, data.jobId ?? '', { outputName, steps })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start training')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = outputName.trim() && datasetId && triggerWord.trim() && !submitting

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Output Name */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Output Name
        </label>
        <input
          type="text"
          value={outputName}
          onChange={(e) => setOutputName(e.target.value)}
          placeholder="my-lora-v1"
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
          required
        />
      </div>

      {/* Dataset */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Dataset
        </label>
        {datasetsLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 py-2">
            <SpinnerGap size={14} className="animate-spin" />
            Loading datasets…
          </div>
        ) : datasets.length === 0 ? (
          <p className="text-sm text-zinc-500 py-1">
            No datasets found.{' '}
            <a href="/training/datasets" className="text-emerald-400 hover:text-emerald-300 underline">
              Create one first.
            </a>
          </p>
        ) : (
          <select
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 transition-colors"
            required
          >
            <option value="" disabled>Select a dataset…</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Trigger Word */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Trigger Word
        </label>
        <input
          type="text"
          value={triggerWord}
          onChange={(e) => setTriggerWord(e.target.value)}
          placeholder="e.g. TOK"
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
          required
        />
      </div>

      {/* Steps + Learning Rate */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            Steps
          </label>
          <input
            type="number"
            min={100}
            max={10000}
            step={100}
            value={steps}
            onChange={(e) => setSteps(Number(e.target.value))}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            Learning Rate
          </label>
          <input
            type="text"
            value={learningRate}
            onChange={(e) => setLearningRate(e.target.value)}
            placeholder="1e-4"
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>
      </div>

      {/* LoRA Rank + Resolution */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            LoRA Rank
          </label>
          <select
            value={loraRank}
            onChange={(e) => setLoraRank(Number(e.target.value))}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 transition-colors"
          >
            {LORA_RANKS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            Resolution
          </label>
          <input
            type="number"
            min={256}
            max={2048}
            step={64}
            value={resolution}
            onChange={(e) => setResolution(Number(e.target.value))}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className="flex items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <>
            <SpinnerGap size={14} className="animate-spin" />
            Starting…
          </>
        ) : (
          'Start Training'
        )}
      </button>
    </form>
  )
}
