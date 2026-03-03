'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  UploadSimple,
  MagicWand,
  Flask as FlaskConical,
  RocketLaunch,
  CheckCircle,
  ArrowRight,
  Warning,
  Spinner,
  Monitor,
  Play,
  ArrowCounterClockwise,
} from 'phosphor-react'

interface WorkflowIO {
  nodeId: string
  nodeType: string
  nodeTitle: string
  paramName: string
  paramType: string
  defaultValue?: unknown
  options?: string[]
  isInput: boolean
}

interface ComfyInstance {
  port: number
  systemStats: Record<string, unknown> | null
}

interface Tool {
  id: string
  name: string
  comfyPort: number | null
  schemaJson: string
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Attach Workflow', icon: UploadSimple },
  { label: 'Auto-Configure', icon: MagicWand },
  { label: 'Test', icon: FlaskConical },
  { label: 'Deploy', icon: RocketLaunch },
]

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, i) => {
        const Icon = step.icon
        const done = i < current
        const active = i === current
        return (
          <div key={step.label} className="flex items-center">
            <div
              className={[
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                done ? 'text-emerald-400' : active ? 'text-indigo-300 bg-indigo-600/20' : 'text-zinc-600',
              ].join(' ')}
            >
              {done ? (
                <CheckCircle size={16} weight="fill" className="text-emerald-400" />
              ) : (
                <Icon size={16} weight={active ? 'duotone' : 'regular'} />
              )}
              <span className="hidden sm:inline">{step.label}</span>
              <span className="text-xs text-zinc-600 hidden sm:inline">
                {i + 1}/{STEPS.length}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-6 h-px mx-1 ${done ? 'bg-emerald-800' : 'bg-zinc-800'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: Attach Workflow ──────────────────────────────────────────────────

function StepAttach({
  onNext,
}: {
  onNext: (workflowJson: string) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setText(content)
      setError('')
    }
    reader.readAsText(file)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const handleNext = () => {
    if (!text.trim()) { setError('Paste a workflow JSON or upload a file.'); return }
    try {
      JSON.parse(text)
    } catch {
      setError('Invalid JSON.')
      return
    }
    onNext(text)
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-zinc-100 mb-1">Attach Workflow</h2>
        <p className="text-sm text-zinc-500">Upload a ComfyUI workflow JSON file or paste it below.</p>
      </div>

      {/* Hidden real file input — triggered by the button below */}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
      />

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="flex flex-col items-center justify-center gap-4 p-10 border-2 border-dashed border-zinc-700 rounded-xl hover:border-zinc-600 transition-colors"
      >
        <UploadSimple size={28} weight="duotone" className="text-zinc-500" />
        <p className="text-sm text-zinc-400">Drop a workflow .json here, or</p>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
        >
          Browse file…
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-zinc-800" />
        <span className="text-xs text-zinc-600">or paste</span>
        <div className="flex-1 h-px bg-zinc-800" />
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setError('') }}
        placeholder='{"last_node_id": 9, "nodes": [...]}'
        rows={8}
        className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-xs font-mono text-zinc-300 focus:outline-none focus:border-indigo-500 resize-none placeholder:text-zinc-700"
      />

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <Warning size={14} weight="fill" />
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Analyze Workflow
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── Step 2: Auto-Configure ───────────────────────────────────────────────────

function StepConfigure({
  workflowJson,
  onNext,
}: {
  workflowJson: string
  onNext: (tool: Tool) => void
}) {
  const [schema, setSchema] = useState<WorkflowIO[] | null>(null)
  const [workflowHash, setWorkflowHash] = useState('')
  const [instances, setInstances] = useState<ComfyInstance[]>([])
  const [scanning, setScanning] = useState(false)
  const [selectedPort, setSelectedPort] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')

  // Analyze workflow on mount
  useEffect(() => {
    const analyze = async () => {
      try {
        const res = await fetch('/api/workflow/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowJson }),
        })
        if (!res.ok) {
          const err = await res.json()
          setAnalyzeError(err.error ?? 'Analysis failed')
          return
        }
        const { schema: s, hash } = await res.json()
        setSchema(s)
        setWorkflowHash(hash)
      } catch {
        setAnalyzeError('Failed to analyze workflow')
      }
    }
    analyze()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scanPorts = async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/comfy/scan')
      const data: ComfyInstance[] = await res.json()
      setInstances(data)
      if (data.length > 0) setSelectedPort(data[0].port)
    } catch {
      // ignore
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => { scanPorts() }, [])

  const handleNext = async () => {
    if (!name.trim()) { setError('Enter a tool name.'); return }
    if (!schema) { setError('Workflow analysis in progress.'); return }

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          workflowJson,
          workflowHash,
          schemaJson: JSON.stringify(schema),
          comfyPort: selectedPort,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? 'Failed to save tool')
        return
      }
      const tool: Tool = await res.json()
      onNext(tool)
    } catch {
      setError('Failed to save tool')
    } finally {
      setSaving(false)
    }
  }

  const getDeviceName = (inst: ComfyInstance) => {
    try {
      const stats = inst.systemStats as { devices?: { name: string }[] }
      if (stats?.devices?.[0]?.name) return stats.devices[0].name
    } catch { /* ignore */ }
    return 'Unknown device'
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-100 mb-1">Auto-Configure</h2>
        <p className="text-sm text-zinc-500">Review detected inputs/outputs, choose a ComfyUI instance, and name your tool.</p>
      </div>

      {/* Schema table */}
      {analyzeError && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <Warning size={14} weight="fill" />
          {analyzeError}
        </div>
      )}

      {!schema && !analyzeError && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Spinner size={14} className="animate-spin" />
          Analyzing workflow…
        </div>
      )}

      {schema && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            Detected Parameters ({schema.length})
          </h3>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left">
                  <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Node</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Field</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Type</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Default</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Direction</th>
                </tr>
              </thead>
              <tbody>
                {schema.map((f) => (
                  <tr key={`${f.nodeId}-${f.paramName}`} className="border-b border-zinc-800/50 last:border-0">
                    <td className="px-4 py-2.5 text-zinc-300 font-medium text-xs">
                      {f.nodeTitle || f.nodeType}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400 font-mono text-xs">{f.paramName}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-xs font-mono">
                        {f.paramType}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600 text-xs font-mono truncate max-w-32">
                      {String(f.defaultValue ?? '—')}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium ${f.isInput ? 'text-indigo-400' : 'text-emerald-400'}`}>
                        {f.isInput ? '→ Input' : '← Output'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ComfyUI selector */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            ComfyUI Instance
          </h3>
          <button
            onClick={scanPorts}
            disabled={scanning}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            <ArrowCounterClockwise size={12} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning…' : 'Refresh'}
          </button>
        </div>

        {scanning && instances.length === 0 && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-3">
            <Spinner size={14} className="animate-spin" />
            Scanning ports 6188-16188...
          </div>
        )}

        {!scanning && instances.length === 0 && (
          <div className="flex items-center gap-3 p-4 bg-amber-950/20 border border-amber-900/30 rounded-xl text-amber-400 text-sm">
            <Monitor size={16} weight="duotone" />
            No running ComfyUI detected. Start ComfyUI and click Refresh.
          </div>
        )}

        {instances.length > 0 && (
          <div className="flex flex-col gap-2">
            {instances.map((inst) => (
              <label
                key={inst.port}
                className={[
                  'flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors',
                  selectedPort === inst.port
                    ? 'border-indigo-500 bg-indigo-600/10'
                    : 'border-zinc-800 hover:border-zinc-600',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="comfy-port"
                  value={inst.port}
                  checked={selectedPort === inst.port}
                  onChange={() => setSelectedPort(inst.port)}
                  className="accent-indigo-500"
                />
                <Monitor size={16} weight="duotone" className="text-zinc-400" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-zinc-200">Port {inst.port}</div>
                  <div className="text-xs text-zinc-500">{getDeviceName(inst)}</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Name + Description */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400">Tool Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError('') }}
            placeholder="e.g. Character Portrait Generator"
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional short description of what this tool does…"
            rows={2}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <Warning size={14} weight="fill" />
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleNext}
          disabled={saving || !schema}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? <Spinner size={14} className="animate-spin" /> : null}
          {selectedPort ? 'Save & Test' : 'Save (test later)'}
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: Test ─────────────────────────────────────────────────────────────

function StepTest({
  tool,
  onNext,
}: {
  tool: Tool
  onNext: () => void
}) {
  const schema: WorkflowIO[] = tool.schemaJson
    ? (JSON.parse(tool.schemaJson) as WorkflowIO[]).filter((f) => f.isInput)
    : []

  const [inputs, setInputs] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {}
    for (const f of schema) {
      defaults[`${f.nodeId}__${f.paramName}`] = f.defaultValue ?? ''
    }
    return defaults
  })

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [outputs, setOutputs] = useState<{ filename: string }[]>([])
  const [execMeta, setExecMeta] = useState<{ seed: number; elapsed: string } | null>(null)
  const [error, setError] = useState('')

  const handleRun = async () => {
    setRunning(true)
    setProgress(0)
    setOutputs([])
    setError('')
    setExecMeta(null)
    const startTime = Date.now()

    try {
      const res = await fetch(`/api/tools/${tool.id}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? 'Run failed')
        setRunning(false)
        return
      }

      const result = await res.json() as {
        executionId: string
        promptId: string
        comfyPort: number
        seed: number
      }

      // Poll history until completed
      const pollInterval = setInterval(async () => {
        try {
          const histRes = await fetch(`/api/comfy/${result.comfyPort}/history/${result.promptId}`)
          if (!histRes.ok) return
          const hist = await histRes.json() as Record<string, {
            status?: { completed?: boolean; status_str?: string }
            outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>
          }>
          const entry = hist[result.promptId]
          if (!entry) return

          if (entry.status?.completed) {
            clearInterval(pollInterval)
            // Extract output images
            const images: { filename: string }[] = []
            for (const nodeOut of Object.values(entry.outputs ?? {})) {
              for (const img of nodeOut.images ?? []) {
                images.push({ filename: img.filename })
              }
            }
            setOutputs(images)
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
            setExecMeta({ seed: result.seed, elapsed: `${elapsed}s` })
            setRunning(false)
            setProgress(null)

            // Update execution record
            await fetch(`/api/executions/${result.executionId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: entry.status.status_str === 'error' ? 'error' : 'completed',
                outputsJson: JSON.stringify(images),
                completedAt: Date.now(),
              }),
            })
          }
        } catch { /* ignore */ }
      }, 2000)

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval)
        if (running) {
          setError('Timed out waiting for ComfyUI')
          setRunning(false)
          setProgress(null)
        }
      }, 300_000)

    } catch {
      setError('Failed to start execution')
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-100 mb-1">Test in Dev Mode</h2>
        <p className="text-sm text-zinc-500">Run the tool with test inputs before deploying to production.</p>
      </div>

      {/* Inputs */}
      {schema.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Inputs</h3>
          {schema.map((field) => {
            const key = `${field.nodeId}__${field.paramName}`
            const label = field.nodeTitle ? `${field.nodeTitle} — ${field.paramName}` : field.paramName
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">{label}</label>
                <input
                  type={field.paramType === 'number' ? 'number' : 'text'}
                  value={String(inputs[key] ?? '')}
                  onChange={(e) =>
                    setInputs((prev) => ({
                      ...prev,
                      [key]: field.paramType === 'number' ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )
          })}
        </div>
      )}

      {/* No ComfyUI warning */}
      {!tool.comfyPort && (
        <div className="flex items-center gap-3 p-4 bg-amber-950/20 border border-amber-900/30 rounded-xl text-amber-400 text-sm">
          <Monitor size={16} weight="duotone" />
          No ComfyUI instance was selected. Start ComfyUI, go back and re-save, or skip to Deploy.
        </div>
      )}

      {/* Run button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleRun}
          disabled={running || !tool.comfyPort}
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {running ? (
            <>
              <Spinner size={14} className="animate-spin" />
              {progress !== null ? `${progress}%` : 'Running…'}
            </>
          ) : (
            <>
              <Play size={14} weight="fill" />
              Run Test
            </>
          )}
        </button>

        {running && progress !== null && (
          <div className="flex-1 bg-zinc-800 rounded-full h-1.5 max-w-xs">
            <div
              className="bg-indigo-500 h-full rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <Warning size={14} weight="fill" />
          {error}
        </div>
      )}

      {/* Output preview */}
      {outputs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Output Preview</h3>
          <div className="grid grid-cols-2 gap-3">
            {outputs.map((out) => (
              <img
                key={out.filename}
                src={`/api/comfy/${tool.comfyPort}/view?filename=${encodeURIComponent(out.filename)}&type=output`}
                alt={out.filename}
                className="w-full rounded-xl border border-zinc-800"
              />
            ))}
          </div>
        </div>
      )}

      {execMeta && (
        <div className="flex gap-4 text-xs text-zinc-500 font-mono">
          <span>seed: {execMeta.seed}</span>
          <span>elapsed: {execMeta.elapsed}</span>
        </div>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
        <span className="text-sm text-zinc-500">Satisfied with the output?</span>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Deploy to Production
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── Step 4: Deploy ───────────────────────────────────────────────────────────

function StepDeploy({ tool }: { tool: Tool }) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'deploying' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  const handleDeploy = async () => {
    setStatus('deploying')
    setError('')
    try {
      const res = await fetch(`/api/tools/${tool.id}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? 'Deploy failed')
        setStatus('error')
        return
      }
      setStatus('done')
    } catch {
      setError('Deploy failed')
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-emerald-600/20 flex items-center justify-center">
          <CheckCircle size={32} weight="fill" className="text-emerald-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-zinc-100 mb-1">Tool deployed!</h2>
          <p className="text-sm text-zinc-500">{tool.id} is now live in production.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/apps')}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            View in Apps Dashboard
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-100 mb-1">Deploy</h2>
        <p className="text-sm text-zinc-500">
          This will pin the current workflow hash and make the tool available in the Apps Dashboard and Canvas.
        </p>
      </div>

      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Tool name</span>
          <span className="text-zinc-200 font-medium">{tool.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">ComfyUI port</span>
          <span className="text-zinc-200 font-mono">{tool.comfyPort ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Status after deploy</span>
          <span className="text-emerald-400 font-medium">production</span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <Warning size={14} weight="fill" />
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleDeploy}
          disabled={status === 'deploying'}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {status === 'deploying' ? (
            <><Spinner size={14} className="animate-spin" /> Deploying…</>
          ) : (
            <><RocketLaunch size={14} weight="fill" /> Deploy Now</>
          )}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BuildToolPage() {
  const [step, setStep] = useState(0)
  const [workflowJson, setWorkflowJson] = useState('')
  const [tool, setTool] = useState<Tool | null>(null)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-100">Build Tool</h1>
          <p className="text-sm text-zinc-500 mt-1">Turn a ComfyUI workflow into a production-ready tool</p>
        </div>

        <StepBar current={step} />

        {step === 0 && (
          <StepAttach
            onNext={(json) => { setWorkflowJson(json); setStep(1) }}
          />
        )}

        {step === 1 && (
          <StepConfigure
            workflowJson={workflowJson}
            onNext={(t) => { setTool(t); setStep(2) }}
          />
        )}

        {step === 2 && tool && (
          <StepTest
            tool={tool}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && tool && (
          <StepDeploy tool={tool} />
        )}
      </div>
    </div>
  )
}
