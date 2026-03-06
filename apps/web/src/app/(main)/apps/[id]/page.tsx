'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { LottieSpinner, FadeIn, StaggerGrid, StaggerItem } from '@/components/ui'
import { ComfyLogsPanel } from '@/components/ComfyLogsPanel'
import { getComfyOrgApiKey } from '@/lib/platform'

interface WorkflowIO {
  nodeId: string
  nodeType: string
  nodeTitle: string
  paramName: string
  paramType: 'string' | 'number' | 'boolean' | 'image' | 'select'
  defaultValue?: unknown
  label?: string
  options?: string[]
  isInput: boolean
  enabled?: boolean
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

// ─── Output renderers ─────────────────────────────────────────────────────────

function BlurRevealImage({ src, alt }: { src: string; alt: string }) {
  const [sharp, setSharp] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSharp(true)))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <img
        src={src}
        alt={alt}
        className="w-full block"
        style={{
          filter: sharp ? 'blur(0px) brightness(1)' : 'blur(28px) brightness(0.7)',
          transform: sharp ? 'scale(1)' : 'scale(1.1)',
          transition: 'filter 2s ease-out, transform 2s ease-out',
        }}
      />
    </div>
  )
}

function inferOutputKind(nodeType: string): 'image' | 'video' | 'audio' | 'model' | 'text' | 'file' {
  if (['FSSaveImage', 'SaveImage', 'PreviewImage', 'SaveAnimatedWEBP', 'SaveAnimatedPNG'].includes(nodeType)) return 'image'
  if (['FSSaveVideo', 'VHS_VideoCombine'].includes(nodeType)) return 'video'
  if (['FSSaveAudio', 'SaveAudio', 'PreviewAudio'].includes(nodeType)) return 'audio'
  if (['FSSave3D', 'FSHunyuan3DGenerate', 'Save3D', 'TripoSGSave', 'MeshSave'].includes(nodeType) || /Save.*3[Dd]|3[Dd].*Save|GLB|GLTF|Mesh/i.test(nodeType)) return 'model'
  if (['FSSaveText', 'FSSaveInteger'].includes(nodeType)) return 'text'
  return 'file'
}

function OutputLoadingPlaceholder({ kind }: { kind: 'image' | 'video' | 'audio' | 'model' | 'text' | 'file' }) {
  if (kind === 'image') {
    return (
      <div className="aspect-square rounded-xl border border-white/5 bg-zinc-950 flex items-center justify-center overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 to-zinc-950 animate-pulse" />
        <LottieSpinner size={36} />
      </div>
    )
  }
  if (kind === 'video') {
    return (
      <div className="col-span-2 aspect-video rounded-xl border border-white/5 bg-zinc-950 flex flex-col items-center justify-center gap-2">
        <Play size={32} weight="fill" className="text-zinc-700" />
        <LottieSpinner size={24} />
      </div>
    )
  }
  if (kind === 'audio') {
    return (
      <div className="col-span-2 h-16 rounded-xl border border-white/5 bg-zinc-950 flex items-center justify-center gap-1 px-4">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="w-1 rounded-full bg-zinc-700 animate-pulse"
            style={{ height: `${8 + Math.sin(i * 0.8) * 8}px`, animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    )
  }
  if (kind === 'model') {
    return (
      <div className="col-span-2 aspect-square rounded-xl border border-white/5 bg-zinc-950 flex flex-col items-center justify-center gap-3">
        <div className="text-4xl opacity-30 animate-spin" style={{ animationDuration: '3s' }}>⬡</div>
        <LottieSpinner size={24} />
      </div>
    )
  }
  if (kind === 'text') {
    return (
      <div className="col-span-2 rounded-xl border border-white/5 bg-zinc-950 px-4 py-4 flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-3 rounded bg-zinc-800 animate-pulse"
            style={{ width: `${70 - i * 15}%`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="col-span-2 h-16 rounded-xl border border-white/5 bg-zinc-950 flex items-center justify-center">
      <LottieSpinner size={28} />
    </div>
  )
}

let _mvLoaded = false, _mvLoading = false
function loadMV(): Promise<void> {
  return new Promise((resolve) => {
    if (_mvLoaded) { resolve(); return }
    if (typeof window !== 'undefined' && customElements.get('model-viewer')) { _mvLoaded = true; resolve(); return }
    if (_mvLoading) { const t = setInterval(() => { if (_mvLoaded) { clearInterval(t); resolve() } }, 100); return }
    _mvLoading = true
    const s = document.createElement('script')
    s.type = 'module'
    s.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js'
    s.onload = () => { _mvLoaded = true; _mvLoading = false; resolve() }
    s.onerror = () => { _mvLoading = false; resolve() }
    document.head.appendChild(s)
  })
}

function ModelPreview({ src, filename }: { src: string; filename: string }) {
  const [ready, setReady] = useState(false)
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const viewable = ['glb', 'gltf'].includes(ext)
  useEffect(() => { if (viewable) loadMV().then(() => setReady(true)) }, [viewable])
  if (viewable && ready) {
    return (
      <div className="col-span-2 w-full aspect-square rounded-lg overflow-hidden border border-zinc-800">
        {/* @ts-ignore */}
        <model-viewer src={src} alt={filename} auto-rotate camera-controls style={{ width: '100%', height: '100%', background: '#18181b' }} />
      </div>
    )
  }
  return (
    <a href={src} download={filename} className="col-span-2 flex items-center gap-3 px-4 py-3 rounded-lg border border-white/5 bg-zinc-900 hover:bg-zinc-800 transition-colors">
      <Spinner size={16} className="text-violet-400" />
      <span className="text-sm text-zinc-300 flex-1 truncate">{filename}</span>
      <span className="text-xs text-zinc-600">Download 3D</span>
    </a>
  )
}

type OutputItem =
  | { kind: 'image' | 'video' | 'audio' | 'model' | 'file'; filename: string; path: string }
  | { kind: 'text'; text: string }

function inferKind(filename: string): 'image' | 'video' | 'audio' | 'model' | 'file' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) return 'image'
  if (['gif', 'mp4', 'webm', 'avi', 'mov'].includes(ext)) return 'video'
  if (['wav', 'mp3', 'flac', 'ogg', 'aiff', 'm4a'].includes(ext)) return 'audio'
  if (['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'].includes(ext)) return 'model'
  return 'file'
}

function OutputGrid({ outputs, comfyPort }: { outputs: OutputItem[]; comfyPort: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {outputs.map((out, i) => {
        if (out.kind === 'text') {
          return (
            <div key={i} className="col-span-2 bg-zinc-900 border border-white/5 rounded-lg px-4 py-3">
              <p className="text-sm text-zinc-300 whitespace-pre-wrap font-mono-custom">{out.text}</p>
            </div>
          )
        }
        const url = `/api/comfy/${comfyPort}/view?filename=${encodeURIComponent(out.filename)}&type=output`
        if (out.kind === 'image') return <BlurRevealImage key={out.filename} src={url} alt={out.filename} />
        if (out.kind === 'video') return <video key={out.filename} src={url} controls loop className="w-full rounded-lg border border-zinc-800 bg-black" />
        if (out.kind === 'audio') return (
          <div key={out.filename} className="col-span-2 flex flex-col gap-1">
            <span className="text-xs text-zinc-500 truncate">{out.filename}</span>
            <audio controls src={url} className="w-full" />
          </div>
        )
        if (out.kind === 'model') return <ModelPreview key={out.filename} src={url} filename={out.filename} />
        return (
          <a key={out.filename} href={url} download={out.filename} className="col-span-2 flex items-center gap-2 px-4 py-3 rounded-lg border border-white/5 bg-zinc-900 hover:bg-zinc-800 transition-colors text-sm text-zinc-300">
            <DownloadSimple size={14} />
            <span className="flex-1 truncate">{out.filename}</span>
            <span className="text-xs text-zinc-600">Download</span>
          </a>
        )
      })}
    </div>
  )
}

// ─── Input field ───────────────────────────────────────────────────────────────

function InputField({
  field,
  value,
  onChange,
}: {
  field: WorkflowIO
  value: unknown
  onChange: (v: unknown) => void
}) {
  const label = field.label || (field.nodeTitle
    ? `${field.nodeTitle} — ${field.paramName}`
    : field.paramName)

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

  const outputs = exec.outputsJson
    ? (JSON.parse(exec.outputsJson) as { kind: string; filename?: string; path?: string }[]).filter((o): o is { kind: string; filename: string; path: string } => !!o.filename)
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
          <LottieSpinner size={14} />
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

function BottomTabs({
  tool,
  executions,
  execLoading,
  onRestore,
}: {
  tool: Tool
  executions: Execution[]
  execLoading: boolean
  onRestore: (inputs: Record<string, unknown>) => void
}) {
  const [tab, setTab] = useState<'history' | 'logs'>('logs')

  return (
    <div className="h-64 flex flex-col border-t border-white/5">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-2 shrink-0">
        {(['logs', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
              tab === t ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {t === 'history' ? 'Run History' : 'Logs'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden px-4 pb-4 pt-2">
        {tab === 'history' && (
          <div className="h-full overflow-y-auto">
            {execLoading && (
              <div className="flex items-center gap-2 text-zinc-600 text-xs">
                <LottieSpinner size={12} />
                Loading…
              </div>
            )}
            {!execLoading && executions.length === 0 && (
              <p className="text-xs text-zinc-600">No runs yet.</p>
            )}
            {!execLoading && executions.length > 0 && (
              <div className="flex flex-col gap-2">
                {executions.map((exec) => (
                  <ExecutionHistoryItem key={exec.id} exec={exec} onRestore={onRestore} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'logs' && tool.comfyPort && (
          <ComfyLogsPanel port={tool.comfyPort} />
        )}
        {tab === 'logs' && !tool.comfyPort && (
          <p className="text-xs text-zinc-600 pt-2">No ComfyUI instance configured.</p>
        )}
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

  const allSchema: WorkflowIO[] = tool?.schemaJson ? JSON.parse(tool.schemaJson) : []
  const schema: WorkflowIO[] = allSchema
    .filter((f) => f.isInput && f.enabled !== false)
    .filter((f) => !(f.paramName === 'label' && f.nodeType.startsWith('FS')))
  const expectedOutputKinds: Array<'image' | 'video' | 'audio' | 'model' | 'text' | 'file'> =
    allSchema.filter((f) => !f.isInput && f.enabled !== false).map((f) => inferOutputKind(f.nodeType))

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
  const [latestOutputs, setLatestOutputs] = useState<OutputItem[]>([])
  const sseRef = useRef<EventSource | null>(null)

  const runMutation = useMutation<ExecResult, Error>({
    mutationFn: async () => {
      const res = await fetch(`/api/tools/${id}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, comfyOrgApiKey: getComfyOrgApiKey() || undefined }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to run')
      }
      return res.json()
    },
    onSuccess: (result) => {
      setRunningId(result.executionId)
      setLatestOutputs([])

      let done = false

      const finish = async () => {
        if (done) return
        done = true
        sseRef.current?.close()
        sseRef.current = null
        clearInterval(pollInterval)

        try {
          const histRes = await fetch(`/api/comfy/${result.comfyPort}/history/${result.promptId}`)
          if (histRes.ok) {
            const hist = await histRes.json() as Record<string, {
              status?: { status_str?: string }
              outputs?: Record<string, {
                images?: { filename: string; subfolder: string }[]
                gifs?: { filename: string; subfolder: string }[]
                audio?: { filename: string; subfolder: string }[]
                text?: string[]
                string?: string[]
              }>
            }>
            const entry = hist[result.promptId]
            const items: OutputItem[] = []
            for (const nodeOut of Object.values(entry?.outputs ?? {})) {
              for (const f of nodeOut.images ?? []) items.push({ kind: inferKind(f.filename), filename: f.filename, path: `${f.subfolder ? f.subfolder + '/' : ''}${f.filename}` })
              for (const f of nodeOut.gifs ?? []) items.push({ kind: inferKind(f.filename), filename: f.filename, path: `${f.subfolder ? f.subfolder + '/' : ''}${f.filename}` })
              for (const f of nodeOut.audio ?? []) items.push({ kind: 'audio', filename: f.filename, path: `${f.subfolder ? f.subfolder + '/' : ''}${f.filename}` })
              for (const t of [...(nodeOut.text ?? []), ...(nodeOut.string ?? [])]) {
                if (typeof t === 'string' && t.trim()) {
                  const k = inferKind(t)
                  if (k !== 'file') items.push({ kind: k, filename: t, path: t })
                  else items.push({ kind: 'text', text: t })
                }
              }
            }
            setLatestOutputs(items)
            await fetch(`/api/executions/${result.executionId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: entry?.status?.status_str === 'error' ? 'error' : 'completed',
                outputsJson: JSON.stringify(items),
                completedAt: Date.now(),
              }),
            })
            qc.invalidateQueries({ queryKey: ['executions', id] })
          }
        } catch { /* ignore */ }

        setRunningId(null)
      }

      // SSE proxy for completion detection (avoids CORS on direct WS)
      const sse = new EventSource(`/api/comfy/${result.comfyPort}/ws`)
      sseRef.current = sse
      sse.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as { type: string; data?: Record<string, unknown> }
          if (msg.data?.prompt_id !== result.promptId) return
          if (msg.type === 'executing' && msg.data?.node === null) { sse.close(); finish() }
          else if (msg.type === 'execution_error') { sse.close(); finish() }
        } catch { /* ignore */ }
      }
      sse.onerror = () => { sse.close() }

      // Fallback poll
      const pollInterval = setInterval(async () => {
        if (done) { clearInterval(pollInterval); return }
        try {
          const histRes = await fetch(`/api/comfy/${result.comfyPort}/history/${result.promptId}`)
          if (!histRes.ok) return
          const hist = await histRes.json() as Record<string, { status?: { completed?: boolean } }>
          if (hist[result.promptId]?.status?.completed) finish()
        } catch { /* ignore */ }
      }, 3000)

      setTimeout(() => {
        if (!done) { done = true; sseRef.current?.close(); sseRef.current = null; clearInterval(pollInterval); setRunningId(null) }
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
        <LottieSpinner size={32} />
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
    <FadeIn from="none" duration={0.3} className="h-full flex flex-col">
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
              <LottieSpinner size={14} />
              Running…
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
                  <div className="grid grid-cols-2 gap-3">
                    {(expectedOutputKinds.length > 0 ? expectedOutputKinds : ['image' as const]).map((kind, i) => (
                      <OutputLoadingPlaceholder key={i} kind={kind} />
                    ))}
                  </div>
                )}

                {latestOutputs.length > 0 && tool.comfyPort && (
                  <OutputGrid outputs={latestOutputs} comfyPort={tool.comfyPort} />
                )}

                {!isRunning && latestOutputs.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <ImageSquare size={32} weight="duotone" className="text-zinc-700 mb-3" />
                    <p className="text-sm text-zinc-600">Run the tool to see output here</p>
                  </div>
                )}
              </div>

              {/* Run history / Logs tabs */}
              <BottomTabs
                tool={tool}
                executions={executions}
                execLoading={execLoading}
                onRestore={handleRestore}
              />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </FadeIn>
  )
}
