import { useState, useEffect, FormEvent } from 'react'
import type { ToolDefinition, WorkflowIO } from '../types'
import { InputField } from './InputField'
import { OutputGallery } from './OutputGallery'
import { useRunTool } from '../hooks/useRunTool'

interface Props {
  tool: ToolDefinition
}

export function ToolRunner({ tool }: Props) {
  const schema: WorkflowIO[] = JSON.parse(tool.schemaJson)
  const inputFields = schema.filter((f) => f.isInput && f.enabled !== false)

  const [inputs, setInputs] = useState<Record<string, unknown>>({})
  const { run, reset, status, result, error } = useRunTool()

  // Seed defaults from schema when tool changes
  useEffect(() => {
    const defaults: Record<string, unknown> = {}
    for (const field of inputFields) {
      if (field.paramName === 'seed') continue
      const key = `${field.nodeId}__${field.paramName}`
      if (field.defaultValue !== undefined && field.defaultValue !== null) {
        defaults[key] = field.defaultValue
      }
    }
    setInputs(defaults)
    reset()
  }, [tool.id])

  function handleChange(key: string, value: unknown) {
    setInputs((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await run(tool.id, inputs)
  }

  const running = status === 'running'

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">{tool.name}</h1>
        {tool.description && (
          <p className="text-sm text-zinc-500 mt-1">{tool.description}</p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            production
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500">
            {tool.engine}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {inputFields.length === 0 && (
          <p className="text-sm text-zinc-500 italic">This tool has no configurable inputs.</p>
        )}

        {inputFields.map((field) => (
          <InputField
            key={`${field.nodeId}__${field.paramName}`}
            field={field}
            value={inputs[`${field.nodeId}__${field.paramName}`]}
            comfyPort={tool.comfyPort}
            onChange={handleChange}
          />
        ))}

        {error && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={running}
            className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {running && (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {running ? 'Running…' : 'Run'}
          </button>

        </div>
      </form>

      <OutputGallery
        outputs={result?.outputs ?? []}
        running={running}
      />
    </div>
  )
}
