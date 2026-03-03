'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  UploadSimple,
  MagicWand,
  Flask as FlaskConical,
  RocketLaunch,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Warning,
  Spinner,
  Monitor,
  Play,
  ArrowCounterClockwise,
  X,
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
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((step, i) => {
        const Icon = step.icon
        const done = i < current
        const active = i === current
        return (
          <div key={step.label} className="flex items-center">
            <div
              className={[
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                done ? 'text-emerald-400' : active ? 'text-emerald-300 bg-emerald-600/20' : 'text-zinc-600',
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

// ─── Upload Modal ─────────────────────────────────────────────────────────────

function UploadModal({
  onClose,
  onNext,
}: {
  onClose: () => void
  onNext: (workflowJson: string, name: string) => void
}) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => { setText(e.target?.result as string); setError('') }
    reader.readAsText(file)
    setFileName(file.name.replace(/\.json$/i, ''))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const handleNext = () => {
    if (!text.trim()) { setError('Paste a workflow JSON or upload a file.'); return }
    try { JSON.parse(text) } catch { setError('Invalid JSON.'); return }
    onNext(text, fileName)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-zinc-950 border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col gap-5 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-tech text-base font-semibold text-zinc-100">Upload Workflow</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-200 transition-colors">
            <X size={16} />
          </button>
        </div>

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
          className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-white/10 rounded-xl hover:border-emerald-500/30 transition-colors"
        >
          <UploadSimple size={24} weight="duotone" className="text-zinc-500" />
          <p className="text-sm text-zinc-400">Drop a workflow .json here, or</p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 text-zinc-300 text-sm font-medium rounded-md transition-colors"
          >
            Browse file…
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-xs text-zinc-600">or paste JSON</span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setError('') }}
          placeholder='{"last_node_id": 9, "nodes": [...]}'
          rows={6}
          className="bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-xs font-mono-custom text-zinc-300 focus:outline-none focus:border-emerald-500/50 resize-none placeholder:text-zinc-700"
        />

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <Warning size={14} weight="fill" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleNext}
            className="flex items-center gap-2 px-5 py-2 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md transition-colors"
          >
            Analyze Workflow
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Step 1: Attach Workflow ──────────────────────────────────────────────────

function StepAttach({
  onNext,
}: {
  onNext: (workflowJson: string, name: string) => void
}) {
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [instances, setInstances] = useState<ComfyInstance[]>([])
  const [selectedPort, setSelectedPort] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  const [workflows, setWorkflows] = useState<string[]>([])
  const [loadingWorkflows, setLoadingWorkflows] = useState(false)
  const [loadingWorkflow, setLoadingWorkflow] = useState<string | null>(null)
  const [error, setError] = useState('')

  const scanPorts = async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/comfy/scan')
      const data: ComfyInstance[] = await res.json()
      setInstances(data)
      if (data.length > 0) setSelectedPort(data[0].port)
    } catch { /* ignore */ } finally {
      setScanning(false)
    }
  }

  const fetchWorkflows = useCallback(async (port: number) => {
    setLoadingWorkflows(true)
    setWorkflows([])
    try {
      const res = await fetch(`/api/comfy/${port}/userdata?dir=workflows&recurse=true`)
      if (!res.ok) return
      const data = await res.json()
      const files: string[] = Array.isArray(data) ? data : (data.files ?? [])
      setWorkflows(files.filter((f: string) => f.endsWith('.json')))
    } catch { /* ignore */ } finally {
      setLoadingWorkflows(false)
    }
  }, [])

  useEffect(() => { scanPorts() }, [])

  useEffect(() => {
    if (selectedPort) fetchWorkflows(selectedPort)
  }, [selectedPort, fetchWorkflows])

  const handleSelectWorkflow = async (filename: string) => {
    if (!selectedPort) return
    setLoadingWorkflow(filename)
    setError('')
    try {
      // The listing returns bare filenames; files live in the `workflows/` subdir.
      // ComfyUI's /userdata/{file} route uses a single path segment, so the
      // directory separator must be percent-encoded for the router to match correctly.
      const encodedPath = encodeURIComponent(`workflows/${filename}`)
      const res = await fetch(`/api/comfy/${selectedPort}/userdata/${encodedPath}`)
      if (!res.ok) throw new Error(`Failed to load workflow (${res.status})`)
      const json = await res.text()
      JSON.parse(json)
      onNext(json, workflowDisplayName(filename))
    } catch (e: any) {
      setError(e.message ?? 'Failed to load workflow')
    } finally {
      setLoadingWorkflow(null)
    }
  }

  const workflowDisplayName = (filename: string) =>
    filename.replace(/\.json$/, '')

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-tech text-base font-semibold text-zinc-100 mb-1">Attach Workflow</h2>
            <p className="text-sm text-zinc-500">Pick a saved ComfyUI workflow or upload a file.</p>
          </div>
          <button
            onClick={() => setUploadModalOpen(true)}
            className="shrink-0 flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 text-zinc-300 text-sm font-medium rounded-md transition-colors"
          >
            <UploadSimple size={14} />
            Upload / Paste
          </button>
        </div>

        {/* Instance bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">ComfyUI Instance</span>
            {instances.length > 1 && (
              <div className="flex gap-1">
                {instances.map((inst) => (
                  <button
                    key={inst.port}
                    onClick={() => setSelectedPort(inst.port)}
                    className={[
                      'px-2 py-0.5 rounded text-xs border transition-colors',
                      selectedPort === inst.port
                        ? 'border-emerald-500 bg-emerald-600/10 text-emerald-300'
                        : 'border-zinc-800 text-zinc-500 hover:border-zinc-600',
                    ].join(' ')}
                  >
                    :{inst.port}
                  </button>
                ))}
              </div>
            )}
            {instances.length === 1 && selectedPort && (
              <span className="text-xs text-zinc-600 font-mono-custom">:{selectedPort}</span>
            )}
          </div>
          <button
            onClick={scanPorts}
            disabled={scanning}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            <ArrowCounterClockwise size={12} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning…' : 'Refresh'}
          </button>
        </div>

        {/* States */}
        {scanning && instances.length === 0 && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-2">
            <Spinner size={14} className="animate-spin" />
            Scanning for ComfyUI…
          </div>
        )}

        {!scanning && instances.length === 0 && (
          <div className="flex items-center gap-3 p-4 bg-amber-950/20 border border-amber-900/30 rounded-xl text-amber-400 text-sm">
            <Monitor size={16} weight="duotone" />
            No running ComfyUI detected. Start ComfyUI and click Refresh.
          </div>
        )}

        {loadingWorkflows && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-2">
            <Spinner size={14} className="animate-spin" />
            Loading workflows…
          </div>
        )}

        {!loadingWorkflows && selectedPort && workflows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-600">
            <MagicWand size={28} weight="duotone" />
            <span className="text-sm">No saved workflows found</span>
            <span className="text-xs text-zinc-700">Save a workflow in ComfyUI, or use Upload / Paste above</span>
          </div>
        )}

        {/* Workflow grid */}
        {!loadingWorkflows && workflows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {workflows.map((path) => {
              const name = workflowDisplayName(path)
              const isLoading = loadingWorkflow === path
              return (
                <button
                  key={path}
                  onClick={() => handleSelectWorkflow(path)}
                  disabled={loadingWorkflow !== null}
                  className="group flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 hover:bg-zinc-900 hover:border-emerald-500/30 hover:shadow-xl hover:shadow-emerald-900/10 hover:-translate-y-1 transition-all duration-200 disabled:opacity-50 text-left"
                >
                  {/* Preview surface */}
                  <div className="relative h-36 bg-[var(--color-background-canvas)] overflow-hidden bg-grid-pattern">
                    <div className="absolute inset-0 flex items-center justify-center">
                      {isLoading ? (
                        <Spinner size={20} className="text-zinc-500 animate-spin" />
                      ) : (
                        <MagicWand
                          size={32}
                          weight="duotone"
                          className="text-zinc-700 group-hover:text-emerald-500 transition-colors"
                        />
                      )}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#18181b] to-transparent" />
                  </div>
                  {/* Card footer */}
                  <div className="px-4 py-3 bg-[#18181b]">
                    <p className="text-sm font-medium text-zinc-100 truncate group-hover:text-white transition-colors">
                      {name}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <Warning size={14} weight="fill" />
            {error}
          </div>
        )}
      </div>

      {uploadModalOpen && (
        <UploadModal
          onClose={() => setUploadModalOpen(false)}
          onNext={(json, name) => { setUploadModalOpen(false); onNext(json, name) }}
        />
      )}
    </>
  )
}

// ─── Editable default cell ────────────────────────────────────────────────────

function EditableDefault({
  field,
  onChange,
}: {
  field: WorkflowIO
  onChange: (value: unknown) => void
}) {
  // Outputs and image inputs can't be configured inline
  if (!field.isInput || field.paramType === 'image') {
    return <span className="text-zinc-600 font-mono-custom text-xs">{String(field.defaultValue ?? '—')}</span>
  }

  if (field.paramType === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(field.defaultValue)}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-emerald-500 w-4 h-4"
      />
    )
  }

  if (field.paramType === 'select' && field.options?.length) {
    return (
      <select
        value={String(field.defaultValue ?? field.options[0])}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-950 border border-white/5 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/50"
      >
        {field.options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={field.paramType === 'number' ? 'number' : 'text'}
      value={String(field.defaultValue ?? '')}
      onChange={(e) =>
        onChange(field.paramType === 'number' ? Number(e.target.value) : e.target.value)
      }
      className="w-full bg-zinc-950 border border-white/5 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/50 font-mono-custom"
    />
  )
}

// ─── Step 2: Auto-Configure ───────────────────────────────────────────────────

function StepConfigure({
  workflowJson,
  initialName,
  onBack,
  onNext,
}: {
  workflowJson: string
  initialName: string
  onBack: () => void
  onNext: (tool: Tool) => void
}) {
  const [schema, setSchema] = useState<WorkflowIO[] | null>(null)
  const [workflowHash, setWorkflowHash] = useState('')
  const [instances, setInstances] = useState<ComfyInstance[]>([])
  const [scanning, setScanning] = useState(false)
  const [selectedPort, setSelectedPort] = useState<number | null>(null)
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')
  // Keys of enabled (visible) fields — format: "nodeId__paramName"
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set())

  const fieldKey = (f: WorkflowIO) => `${f.nodeId}__${f.paramName}`

  const runAnalyze = useCallback(async (port?: number | null) => {
    try {
      const body: Record<string, unknown> = { workflowJson }
      if (port) body.comfyPort = port
      const res = await fetch('/api/workflow/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        setAnalyzeError(err.error ?? 'Analysis failed')
        return
      }
      const { schema: s, hash } = await res.json()
      setSchema(s)
      setWorkflowHash(hash)
      setAnalyzeError('')
      // Enable all fields by default; preserve existing choices on re-analyze
      setEnabledKeys((prev) => {
        const next = new Set(prev)
        for (const f of s as WorkflowIO[]) next.add(`${f.nodeId}__${f.paramName}`)
        return next
      })
    } catch {
      setAnalyzeError('Failed to analyze workflow')
    }
  }, [workflowJson])

  // Analyze on mount (no port yet — uses static widget-param table)
  useEffect(() => { runAnalyze() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Re-analyze when a port is selected so /object_info can resolve custom nodes
  useEffect(() => {
    if (selectedPort) runAnalyze(selectedPort)
  }, [selectedPort]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDefaultChange = useCallback((nodeId: string, paramName: string, value: unknown) => {
    setSchema((prev) =>
      prev?.map((f) =>
        f.nodeId === nodeId && f.paramName === paramName ? { ...f, defaultValue: value } : f
      ) ?? null
    )
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

    const visibleSchema = schema.filter((f) => enabledKeys.has(fieldKey(f)))
    if (visibleSchema.length === 0) { setError('Select at least one input or output.'); return }
    if (!visibleSchema.some((f) => !f.isInput)) { setError('Select at least one output.'); return }

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
          schemaJson: JSON.stringify(visibleSchema),
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
        <h2 className="font-tech text-base font-semibold text-zinc-100 mb-1">Auto-Configure</h2>
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

      {schema && (() => {
        const inputs = schema.filter((f) => f.isInput)
        const outputs = schema.filter((f) => !f.isInput)
        return (
          <div className="flex flex-col gap-6">
            {/* ── Inputs ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Inputs ({inputs.length})
                </h3>
                <span className="text-xs text-zinc-600">Edit default values below</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-left">
                      <th className="pl-4 pr-2 py-2.5">
                        <input
                          type="checkbox"
                          checked={inputs.length > 0 && inputs.every((f) => enabledKeys.has(fieldKey(f)))}
                          onChange={(e) => {
                            setEnabledKeys((prev) => {
                              const next = new Set(prev)
                              inputs.forEach((f) => e.target.checked ? next.add(fieldKey(f)) : next.delete(fieldKey(f)))
                              return next
                            })
                          }}
                          className="accent-emerald-500 w-4 h-4"
                          title="Toggle all inputs"
                        />
                      </th>
                      <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Node</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Field</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Type</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 w-48">Default Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inputs.map((f) => {
                      const key = fieldKey(f)
                      const enabled = enabledKeys.has(key)
                      return (
                        <tr
                          key={key}
                          onClick={() =>
                            setEnabledKeys((prev) => {
                              const next = new Set(prev)
                              enabled ? next.delete(key) : next.add(key)
                              return next
                            })
                          }
                          className={`border-b border-zinc-800/50 last:border-0 cursor-pointer transition-opacity ${enabled ? '' : 'opacity-35'}`}
                        >
                          <td className="pl-4 pr-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() =>
                                setEnabledKeys((prev) => {
                                  const next = new Set(prev)
                                  enabled ? next.delete(key) : next.add(key)
                                  return next
                                })
                              }
                              className="accent-emerald-500 w-4 h-4"
                            />
                          </td>
                          <td className="px-4 py-2.5 text-zinc-300 font-medium text-xs">
                            {f.nodeTitle || f.nodeType}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-400 font-mono-custom text-xs">{f.paramName}</td>
                          <td className="px-4 py-2.5">
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-xs font-mono-custom">
                              {f.paramType}
                            </span>
                          </td>
                          <td className="px-4 py-2 w-48" onClick={(e) => e.stopPropagation()}>
                            <EditableDefault
                              field={f}
                              onChange={(value) => handleDefaultChange(f.nodeId, f.paramName, value)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Outputs ── */}
            {outputs.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Outputs ({outputs.length})
                </h3>
                <div className="overflow-x-auto rounded-xl border border-white/5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-left">
                        <th className="pl-4 pr-2 py-2.5">
                          <input
                            type="checkbox"
                            checked={outputs.length > 0 && outputs.every((f) => enabledKeys.has(fieldKey(f)))}
                            onChange={(e) => {
                              setEnabledKeys((prev) => {
                                const next = new Set(prev)
                                outputs.forEach((f) => e.target.checked ? next.add(fieldKey(f)) : next.delete(fieldKey(f)))
                                return next
                              })
                            }}
                            className="accent-emerald-500 w-4 h-4"
                            title="Toggle all outputs"
                          />
                        </th>
                        <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Node</th>
                        <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Field</th>
                        <th className="px-4 py-2.5 text-xs font-medium text-zinc-500">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outputs.map((f) => {
                        const key = fieldKey(f)
                        const enabled = enabledKeys.has(key)
                        return (
                          <tr
                            key={key}
                            onClick={() =>
                              setEnabledKeys((prev) => {
                                const next = new Set(prev)
                                enabled ? next.delete(key) : next.add(key)
                                return next
                              })
                            }
                            className={`border-b border-zinc-800/50 last:border-0 cursor-pointer transition-opacity ${enabled ? '' : 'opacity-35'}`}
                          >
                            <td className="pl-4 pr-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={() =>
                                  setEnabledKeys((prev) => {
                                    const next = new Set(prev)
                                    enabled ? next.delete(key) : next.add(key)
                                    return next
                                  })
                                }
                                className="accent-emerald-500 w-4 h-4"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-zinc-300 font-medium text-xs">
                              {f.nodeTitle || f.nodeType}
                            </td>
                            <td className="px-4 py-2.5 text-zinc-400 font-mono-custom text-xs">{f.paramName}</td>
                            <td className="px-4 py-2.5">
                              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-xs font-mono-custom">
                                {f.paramType}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })()}

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
                    ? 'border-emerald-500 bg-emerald-600/10'
                    : 'border-zinc-800 hover:border-zinc-600',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="comfy-port"
                  value={inst.port}
                  checked={selectedPort === inst.port}
                  onChange={() => setSelectedPort(inst.port)}
                  className="accent-emerald-500"
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
            className="bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional short description of what this tool does…"
            rows={2}
            className="bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50 resize-none"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <Warning size={14} weight="fill" />
          {error}
        </div>
      )}

      <div className="flex justify-between items-center">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-zinc-400 hover:text-zinc-200 text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={saving || !schema}
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
  onBack,
  onNext,
}: {
  tool: Tool
  onBack: () => void
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
        <h2 className="font-tech text-base font-semibold text-zinc-100 mb-1">Test in Dev Mode</h2>
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
                  className="bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
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
              className="bg-emerald-500 h-full rounded-full transition-all"
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
        <div className="flex gap-4 text-xs text-zinc-500 font-mono-custom">
          <span>seed: {execMeta.seed}</span>
          <span>elapsed: {execMeta.elapsed}</span>
        </div>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-zinc-400 hover:text-zinc-200 text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md transition-colors"
        >
          Deploy to Production
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── Step 4: Deploy ───────────────────────────────────────────────────────────

function StepDeploy({ tool, onBack }: { tool: Tool; onBack: () => void }) {
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
          <h2 className="font-tech text-base font-semibold text-zinc-100 mb-1">Tool deployed!</h2>
          <p className="text-sm text-zinc-500">{tool.id} is now live in production.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/apps')}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md transition-colors"
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
        <h2 className="font-tech text-base font-semibold text-zinc-100 mb-1">Deploy</h2>
        <p className="text-sm text-zinc-500">
          This will pin the current workflow hash and make the tool available in the Apps Dashboard and Canvas.
        </p>
      </div>

      <div className="p-4 bg-zinc-900/50 border border-white/5 rounded-xl flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Tool name</span>
          <span className="text-zinc-200 font-medium">{tool.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">ComfyUI port</span>
          <span className="text-zinc-200 font-mono-custom">{tool.comfyPort ?? '—'}</span>
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

      <div className="flex justify-between items-center">
        <button
          onClick={onBack}
          disabled={status === 'deploying'}
          className="flex items-center gap-2 px-4 py-2.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-50 text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <button
          onClick={handleDeploy}
          disabled={status === 'deploying'}
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md disabled:opacity-50 transition-colors"
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
  const [workflowName, setWorkflowName] = useState('')
  const [tool, setTool] = useState<Tool | null>(null)

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Build Tool</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Turn a ComfyUI workflow into a production-ready tool</p>
        </div>
      </div>

      <div className="flex-1 p-8">
        <StepBar current={step} />

        {step === 0 && (
          <StepAttach
            onNext={(json, name) => { setWorkflowJson(json); setWorkflowName(name); setStep(1) }}
          />
        )}

        {step === 1 && (
          <div className="max-w-3xl">
            <StepConfigure
              workflowJson={workflowJson}
              initialName={workflowName}
              onBack={() => setStep(0)}
              onNext={(t) => { setTool(t); setStep(2) }}
            />
          </div>
        )}

        {step === 2 && tool && (
          <div className="max-w-3xl">
            <StepTest
              tool={tool}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          </div>
        )}

        {step === 3 && tool && (
          <div className="max-w-3xl">
            <StepDeploy tool={tool} onBack={() => setStep(2)} />
          </div>
        )}
      </div>
    </div>
  )
}
