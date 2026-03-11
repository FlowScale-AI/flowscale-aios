import { useState, useEffect, FormEvent } from 'react'
import { usePipeline, type StepStatus } from '../hooks/usePipeline'
import type { ToolDefinition, ToolOutputItem, WorkflowIO } from '../types'

interface Props {
  genTool: ToolDefinition
  resizeTool: ToolDefinition
}

export function PipelineRunner({ genTool, resizeTool }: Props) {
  const { state, run, reset, getResizeNumericFields } = usePipeline(genTool, resizeTool)
  const [prompt, setPrompt] = useState('')
  const [resizeInputs, setResizeInputs] = useState<Record<string, unknown>>({})

  const resizeFields = getResizeNumericFields()

  // Seed resize field defaults from the resize tool schema
  useEffect(() => {
    const schema: WorkflowIO[] = JSON.parse(resizeTool.schemaJson)
    const defaults: Record<string, unknown> = {}
    for (const [, field] of Object.entries(resizeFields)) {
      const key = `${field.nodeId}__${field.paramName}`
      if (field.defaultValue !== undefined && field.defaultValue !== null) {
        defaults[key] = field.defaultValue
      }
    }
    setResizeInputs(defaults)
  }, [resizeTool.id])

  const isRunning =
    state.generateStatus === 'running' || state.resizeStatus === 'running'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!prompt.trim()) return
    await run(prompt.trim(), resizeInputs)
  }

  function handleResizeChange(key: string, value: unknown) {
    setResizeInputs((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="max-w-2xl mx-auto p-6 w-full">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">Image Gen & Resize</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Generate an image with <span className="text-zinc-300">{genTool.name}</span>, then
          resize it with <span className="text-zinc-300">{resizeTool.name}</span>.
        </p>
      </div>

      {/* Pipeline steps indicator */}
      <PipelineSteps
        generateStatus={state.generateStatus}
        resizeStatus={state.resizeStatus}
      />

      {/* Form */}
      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        {/* Prompt */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-zinc-400">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="A futuristic city at night, neon lights, cyberpunk style…"
            required
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
          />
        </div>

        {/* Resize options */}
        {Object.entries(resizeFields).length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Resize options</p>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(resizeFields).map(([, field]) => {
                const key = `${field.nodeId}__${field.paramName}`
                const label = field.paramName
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase())
                return (
                  <div key={key} className="space-y-1.5">
                    <label className="block text-xs font-medium text-zinc-400">{label}</label>
                    <input
                      type="number"
                      value={(resizeInputs[key] as number) ?? (field.defaultValue as number) ?? ''}
                      onChange={(e) => handleResizeChange(key, Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Error */}
        {state.error && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {state.error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={isRunning || !prompt.trim()}
            className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isRunning && (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {isRunning ? currentStepLabel(state.generateStatus, state.resizeStatus) : 'Generate & Resize'}
          </button>

          {(state.generateStatus !== 'idle' || state.resizeStatus !== 'idle') && !isRunning && (
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </form>

      {/* Results */}
      {state.generateStatus === 'completed' && state.resizeStatus === 'idle' && (
        <IntermediateOutput outputs={state.generatedOutputs} label="Generated image (resizing next…)" />
      )}
      {state.resizeStatus === 'running' && state.generatedOutputs.length > 0 && (
        <IntermediateOutput outputs={state.generatedOutputs} label="Generated — resizing…" dimmed />
      )}
      {state.resizeStatus === 'completed' && (
        <FinalOutput outputs={state.finalOutputs} />
      )}
    </div>
  )
}

// ── Pipeline steps indicator ────────────────────────────────────────────────

function PipelineSteps({
  generateStatus,
  resizeStatus,
}: {
  generateStatus: StepStatus
  resizeStatus: StepStatus
}) {
  return (
    <div className="flex items-center gap-2">
      <StepBadge label="Generate" status={generateStatus} />
      <svg className="w-4 h-4 text-zinc-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <StepBadge label="Resize" status={resizeStatus} />
    </div>
  )
}

function StepBadge({ label, status }: { label: string; status: StepStatus }) {
  const colors: Record<StepStatus, string> = {
    idle: 'bg-zinc-800 text-zinc-500',
    running: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
    completed: 'bg-emerald-500/20 text-emerald-300',
    error: 'bg-red-500/10 text-red-400 border border-red-500/20',
  }
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${colors[status]}`}>
      {status === 'running' && (
        <div className="w-2.5 h-2.5 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
      )}
      {status === 'completed' && (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {status === 'error' && (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      {label}
    </div>
  )
}

// ── Output panels ───────────────────────────────────────────────────────────

function IntermediateOutput({
  outputs,
  label,
  dimmed = false,
}: {
  outputs: ToolOutputItem[]
  label: string
  dimmed?: boolean
}) {
  const images = outputs.filter((o) => o.kind === 'image')
  if (images.length === 0) return null
  return (
    <div className={`mt-6 ${dimmed ? 'opacity-50' : ''}`}>
      <p className="text-xs text-zinc-500 mb-2">{label}</p>
      <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900">
        <img src={images[0].path} alt="Generated" className="w-full object-contain max-h-64" />
      </div>
    </div>
  )
}

function FinalOutput({ outputs }: { outputs: ToolOutputItem[] }) {
  const images = outputs.filter((o) => o.kind === 'image')
  const others = outputs.filter((o) => o.kind !== 'image')

  if (outputs.length === 0) return null

  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Final Output</h3>

      {images.map((item, i) => (
        <a
          key={i}
          href={item.path}
          target="_blank"
          rel="noreferrer"
          className="group block rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 mb-3"
        >
          <div className="relative">
            <img src={item.path} alt={item.filename} className="w-full object-contain" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <svg className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-zinc-600 px-3 py-2 truncate">{item.filename}</p>
        </a>
      ))}

      {others.map((item, i) => (
        <a
          key={i}
          href={item.path}
          download={item.filename}
          className="flex items-center gap-3 rounded-xl p-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors mb-2"
        >
          <svg className="w-5 h-5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-sm text-zinc-300 truncate">{item.filename}</span>
        </a>
      ))}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function currentStepLabel(generateStatus: StepStatus, resizeStatus: StepStatus): string {
  if (generateStatus === 'running') return 'Generating…'
  if (resizeStatus === 'running') return 'Resizing…'
  return 'Running…'
}
