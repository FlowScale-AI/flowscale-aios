'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import {
  Play,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  ImageSquare,
  DownloadSimple,
  Spinner,
  ArrowCounterClockwise,
  Terminal,
  Copy,
  Check,
  X,
} from 'phosphor-react'
import Link from 'next/link'

interface WorkflowIO {
  nodeId: string
  nodeType: string
  nodeTitle: string
  paramName: string
  paramType: 'string' | 'number' | 'boolean' | 'image' | 'select'
  defaultValue?: unknown
  options?: string[]
  isInput: boolean
}

interface Tool {
  id: string
  name: string
  description: string | null
  schemaJson: string
  comfyPort: number | null
  status: string
  version: number | null
}

interface Execution {
  id: string
  inputsJson: string
  outputsJson: string | null
  seed: number | null
  status: string
  errorMessage: string | null
  createdAt: number
  completedAt: number | null
}

interface ExecResult {
  executionId: string
  promptId: string
  clientId: string
  comfyPort: number
  seed: number
}

function InputField({
  field,
  value,
  onChange,
}: {
  field: WorkflowIO
  value: unknown
  onChange: (v: unknown) => void
}) {
  const label = field.nodeTitle
    ? `${field.nodeTitle} — ${field.paramName}`
    : field.paramName

  if (field.paramType === 'boolean') {
    return (
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id={`${field.nodeId}__${field.paramName}`}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 accent-emerald-500"
        />
        <label htmlFor={`${field.nodeId}__${field.paramName}`} className="text-sm text-zinc-300">
          {label}
        </label>
      </div>
    )
  }

  if (field.paramType === 'select' && field.options) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400">{label}</label>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
        >
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    )
  }

  if (field.paramType === 'number') {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400">{label}</label>
        <input
          type="number"
          value={String(value ?? '')}
          onChange={(e) => onChange(Number(e.target.value))}
          className="bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-400">{label}</label>
      <textarea
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50 resize-none"
      />
    </div>
  )
}

function ExecutionHistoryItem({
  exec,
  onRestore,
}: {
  exec: Execution
  onRestore: (inputs: Record<string, unknown>) => void
}) {
  const date = new Date(exec.createdAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const elapsed = exec.completedAt
    ? `${((exec.completedAt - exec.createdAt) / 1000).toFixed(1)}s`
    : null

  const outputs: { filename: string; path: string }[] = exec.outputsJson
    ? JSON.parse(exec.outputsJson)
    : []

  const inputs: Record<string, unknown> = exec.inputsJson ? JSON.parse(exec.inputsJson) : {}

  return (
    <div className="border border-white/5 rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {exec.status === 'completed' && (
          <CheckCircle size={14} weight="fill" className="text-emerald-500 shrink-0" />
        )}
        {exec.status === 'error' && (
          <XCircle size={14} weight="fill" className="text-red-500 shrink-0" />
        )}
        {exec.status === 'running' && (
          <Spinner size={14} className="text-emerald-400 animate-spin shrink-0" />
        )}
        <span className="text-xs text-zinc-400 flex-1">{date}</span>
        {elapsed && <span className="text-xs text-zinc-600">{elapsed}</span>}
        <button
          onClick={() => onRestore(inputs)}
          title="Restore inputs"
          className="text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <ArrowCounterClockwise size={13} />
        </button>
      </div>

      {exec.errorMessage && (
        <p className="text-xs text-red-400">{exec.errorMessage}</p>
      )}

      {outputs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {outputs.map((out) => (
            <a
              key={out.filename}
              href={`/api/comfy/output?path=${encodeURIComponent(out.path)}`}
              download={out.filename}
              className="flex items-center gap-1 px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ImageSquare size={11} />
              {out.filename}
            </a>
          ))}
        </div>
      )}

      {exec.seed !== null && (
        <span className="text-[11px] text-zinc-600 font-mono-custom">seed: {exec.seed}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// cURL modal — uses live input values from the form
// ---------------------------------------------------------------------------

function buildCurlCommand(toolId: string, inputs: Record<string, unknown>): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:14173'
  const body = JSON.stringify({ inputs }, null, 2)
  return `curl -X POST ${origin}/api/tools/${toolId}/executions \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
}

function CurlModal({
  toolId,
  toolName,
  inputs,
  onClose,
}: {
  toolId: string
  toolName: string
  inputs: Record<string, unknown>
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const curl = buildCurlCommand(toolId, inputs)

  const handleCopy = () => {
    navigator.clipboard.writeText(curl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-2xl bg-zinc-950 border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Terminal size={16} className="text-zinc-400" />
            <span className="text-sm font-medium text-zinc-100">cURL — {toolName}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Note */}
        <p className="px-5 pt-4 text-xs text-zinc-500">
          Reflects the current input values in the form. Paste directly into a terminal or import into Postman.
        </p>

        {/* Code block */}
        <div className="relative mx-5 mt-3 mb-5">
          <pre className="bg-zinc-900 border border-white/5 rounded-xl p-4 text-xs text-zinc-300 font-mono-custom overflow-x-auto whitespace-pre leading-relaxed">
            {curl}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors"
          >
            {copied ? (
              <>
                <Check size={12} className="text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ToolPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: tool, isLoading: toolLoading } = useQuery<Tool>({
    queryKey: ['tool', id],
    queryFn: async () => {
      const res = await fetch(`/api/tools/${id}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
  })

  const { data: executions = [], isLoading: execLoading } = useQuery<Execution[]>({
    queryKey: ['executions', id],
    queryFn: async () => {
      const res = await fetch(`/api/tools/${id}/executions`)
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: 5000,
  })

  const schema: WorkflowIO[] = tool?.schemaJson
    ? (JSON.parse(tool.schemaJson) as WorkflowIO[]).filter((f) => f.isInput)
    : []

  // Input state — keyed by nodeId__paramName
  const [inputs, setInputs] = useState<Record<string, unknown>>({})

  // Seed the defaults on first load
  useEffect(() => {
    if (schema.length === 0) return
    setInputs((prev) => {
      if (Object.keys(prev).length > 0) return prev
      const defaults: Record<string, unknown> = {}
      for (const f of schema) {
        defaults[`${f.nodeId}__${f.paramName}`] = f.defaultValue ?? ''
      }
      return defaults
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool?.schemaJson])

  const [showCurl, setShowCurl] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [latestOutputs, setLatestOutputs] = useState<{ filename: string; path: string }[]>([])

  const runMutation = useMutation<ExecResult, Error>({
    mutationFn: async () => {
      const res = await fetch(`/api/tools/${id}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to run')
      }
      return res.json()
    },
    onSuccess: (result) => {
      setRunningId(result.executionId)
      setProgress(0)
      setLatestOutputs([])

      const pollInterval = setInterval(async () => {
        try {
          const histRes = await fetch(`/api/comfy/${result.comfyPort}/history/${result.promptId}`)
          if (!histRes.ok) return
          const hist = await histRes.json() as Record<string, {
            status?: { completed?: boolean; status_str?: string }
            outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>
          }>
          const entry = hist[result.promptId]
          if (!entry?.status?.completed) return

          clearInterval(pollInterval)
          const imgs: { filename: string; path: string }[] = []
          for (const nodeOut of Object.values(entry.outputs ?? {})) {
            for (const img of nodeOut.images ?? []) {
              imgs.push({
                filename: img.filename,
                path: `${img.subfolder ? img.subfolder + '/' : ''}${img.filename}`,
              })
            }
          }
          setLatestOutputs(imgs)
          setRunningId(null)
          setProgress(null)

          await fetch(`/api/executions/${result.executionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: entry.status.status_str === 'error' ? 'error' : 'completed',
              outputsJson: JSON.stringify(imgs),
              completedAt: Date.now(),
            }),
          })
          qc.invalidateQueries({ queryKey: ['executions', id] })
        } catch { /* ignore */ }
      }, 2000)

      setTimeout(() => {
        clearInterval(pollInterval)
        setRunningId(null)
        setProgress(null)
      }, 300_000)
    },
  })

  const handleRestore = useCallback((restored: Record<string, unknown>) => {
    setInputs(restored)
  }, [])

  const isRunning = runMutation.isPending || runningId !== null

  if (toolLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size={24} className="text-emerald-400 animate-spin" />
      </div>
    )
  }

  if (!tool) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
        Tool not found
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Topbar */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-white/5 shrink-0">
        <Link href="/apps" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-zinc-100">{tool.name}</h1>
          {tool.description && (
            <p className="text-xs text-zinc-500 mt-0.5">{tool.description}</p>
          )}
        </div>
        <button
          onClick={() => setShowCurl(true)}
          className="flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white text-sm font-medium rounded-md transition-colors border border-zinc-800 hover:border-zinc-600"
        >
          <Terminal size={14} />
          cURL
        </button>
        <button
          onClick={() => runMutation.mutate()}
          disabled={isRunning || !tool.comfyPort}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold rounded-md transition-colors"
        >
          {isRunning ? (
            <>
              <Spinner size={14} className="animate-spin" />
              {progress !== null ? `${progress}%` : 'Running…'}
            </>
          ) : (
            <>
              <Play size={14} weight="fill" />
              Run
            </>
          )}
        </button>
      </div>

      {/* Error banner */}
      {runMutation.error && (
        <div className="px-6 py-2.5 bg-red-950/30 border-b border-red-900/50 text-red-400 text-sm flex items-center gap-2">
          <XCircle size={14} weight="fill" />
          {runMutation.error.message}
        </div>
      )}

      {/* No ComfyUI warning */}
      {!tool.comfyPort && (
        <div className="px-6 py-2.5 bg-amber-950/30 border-b border-amber-900/50 text-amber-400 text-sm">
          No ComfyUI instance configured for this tool. Re-deploy via Build Tool to assign one.
        </div>
      )}

      {/* cURL modal */}
      {showCurl && (
        <CurlModal
          toolId={tool.id}
          toolName={tool.name}
          inputs={inputs}
          onClose={() => setShowCurl(false)}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup orientation="horizontal">
          {/* Left: Inputs */}
          <Panel defaultSize={40} minSize={25}>
            <div className="h-full overflow-y-auto px-6 py-5">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                Inputs
              </h2>
              {schema.length === 0 ? (
                <p className="text-sm text-zinc-600">No configurable inputs detected.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {schema.map((field) => (
                    <InputField
                      key={`${field.nodeId}__${field.paramName}`}
                      field={field}
                      value={inputs[`${field.nodeId}__${field.paramName}`]}
                      onChange={(v) =>
                        setInputs((prev) => ({
                          ...prev,
                          [`${field.nodeId}__${field.paramName}`]: v,
                        }))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-white/5 hover:bg-emerald-500 transition-colors cursor-col-resize" />

          {/* Right: Outputs + History */}
          <Panel defaultSize={60} minSize={30}>
            <div className="h-full flex flex-col">
              {/* Output viewer */}
              <div className="flex-1 overflow-y-auto px-6 py-5 border-b border-white/5">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                  Output
                </h2>

                {isRunning && latestOutputs.length === 0 && (
                  <div className="flex items-center gap-3 text-zinc-500 text-sm">
                    <Spinner size={14} className="animate-spin text-emerald-400" />
                    Generating…
                    {progress !== null && (
                      <div className="flex-1 bg-zinc-800 rounded-full h-1.5 max-w-xs">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {latestOutputs.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {latestOutputs.map((out) => (
                      <div key={out.filename} className="relative group rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800">
                        <img
                          src={`/api/comfy/${tool.comfyPort}/view?filename=${encodeURIComponent(out.filename)}&type=output`}
                          alt={out.filename}
                          className="w-full h-auto object-cover"
                        />
                        <a
                          href={`/api/comfy/${tool.comfyPort}/view?filename=${encodeURIComponent(out.filename)}&type=output`}
                          download={out.filename}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-black/60 rounded-md text-white"
                        >
                          <DownloadSimple size={14} />
                        </a>
                      </div>
                    ))}
                  </div>
                )}

                {!isRunning && latestOutputs.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <ImageSquare size={32} weight="duotone" className="text-zinc-700 mb-3" />
                    <p className="text-sm text-zinc-600">Run the tool to see output here</p>
                  </div>
                )}
              </div>

              {/* Run history */}
              <div className="h-64 overflow-y-auto px-6 py-4">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Run History
                </h2>
                {execLoading && (
                  <div className="flex items-center gap-2 text-zinc-600 text-xs">
                    <Spinner size={12} className="animate-spin" />
                    Loading…
                  </div>
                )}
                {!execLoading && executions.length === 0 && (
                  <p className="text-xs text-zinc-600">No runs yet.</p>
                )}
                {!execLoading && executions.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {executions.map((exec) => (
                      <ExecutionHistoryItem
                        key={exec.id}
                        exec={exec}
                        onRestore={handleRestore}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
