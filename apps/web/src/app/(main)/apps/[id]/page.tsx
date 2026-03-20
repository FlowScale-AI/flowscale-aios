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
  Copy,
  Check,
  Stop,
} from 'phosphor-react'
import { LottieSpinner, FadeIn, StaggerGrid, StaggerItem } from '@/components/ui'
import { ComfyLogsPanel } from '@/components/ComfyLogsPanel'
import { getComfyOrgApiKey } from '@/lib/platform'
import { FileUploadInput, inferInputUploadKind } from '@/components/FileUploadInput'
import { LocalInferenceSetup, useInferenceStatus } from '@/components/LocalInferenceSetup'
import { ComputePicker } from '@/components/ComputePicker'

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
  engine: string
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
  type?: 'api' | 'comfyui'
  status?: 'running' | 'completed' | 'error'
  outputs?: OutputItem[]
  seed: number
  // ComfyUI only:
  promptId?: string
  clientId?: string
  comfyPort?: number
}

// ─── Output renderers ─────────────────────────────────────────────────────────

function inferOutputKind(nodeType: string): 'image' | 'video' | 'audio' | 'model' | 'text' | 'file' {
  if (['FSSaveImage', 'SaveImage', 'PreviewImage', 'SaveAnimatedWEBP', 'SaveAnimatedPNG'].includes(nodeType)) return 'image'
  if (['FSSaveVideo', 'VHS_VideoCombine', 'SaveVideo'].includes(nodeType)) return 'video'
  if (['FSSaveAudio', 'SaveAudio', 'PreviewAudio'].includes(nodeType)) return 'audio'
  if (['FSSave3D', 'FSHunyuan3DGenerate', 'Save3D', 'TripoSGSave', 'MeshSave'].includes(nodeType) || /Save.*3[Dd]|3[Dd].*Save|GLB|GLTF|Mesh/i.test(nodeType)) return 'model'
  if (['FSSaveText', 'FSSaveInteger'].includes(nodeType)) return 'text'
  return 'file'
}

function OutputLoadingPlaceholder({ kind }: { kind: 'image' | 'video' | 'audio' | 'model' | 'text' | 'file' }) {
  if (kind === 'text') {
    return (
      <div className="col-span-2 sm:col-span-3 rounded-xl border border-white/5 bg-zinc-900/50 px-4 py-3 flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-3 rounded bg-zinc-800 animate-pulse" style={{ width: `${70 - i * 15}%`, animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50">
      <div className="h-36 bg-zinc-950 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 to-zinc-950 animate-pulse" />
        <LottieSpinner size={28} />
      </div>
      <div className="h-9 border-t border-white/5 animate-pulse bg-zinc-950" />
    </div>
  )
}

// ─── Output item renderers ────────────────────────────────────────────────────

function BlurRevealImage({ src, alt }: { src: string; alt: string }) {
  const [sharp, setSharp] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSharp(true)))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      style={{
        filter: sharp ? 'blur(0px) brightness(1)' : 'blur(28px) brightness(0.7)',
        transition: 'filter 2s ease-out',
      }}
    />
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
      // @ts-ignore
      <model-viewer src={src} alt={filename} auto-rotate camera-controls style={{ width: '100%', height: '100%', background: '#18181b' }} />
    )
  }
  return (
    <div className="flex items-center justify-center h-full">
      <span className="text-3xl text-zinc-700">⬡</span>
    </div>
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

function resolveOutputUrl(out: Exclude<OutputItem, { kind: 'text' }>, comfyPort?: number | null): string {
  if (out.path.startsWith('/')) return out.path
  const subfolder = out.path.includes('/') ? out.path.substring(0, out.path.lastIndexOf('/')) : ''
  return `/api/comfy/${comfyPort}/view?filename=${encodeURIComponent(out.filename)}${subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : ''}&type=output`
}

function OutputLightbox({
  item,
  url,
  onClose,
}: {
  item: Exclude<OutputItem, { kind: 'text' }>
  url: string
  onClose: () => void
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const kind = item.kind || inferKind(item.filename)

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8" onClick={onClose}>
      <div className="relative flex flex-col bg-zinc-900 rounded-xl overflow-hidden max-w-[90vw] max-h-[90vh] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Content */}
        <div className="flex-1 min-w-0 flex items-center justify-center bg-black p-4 overflow-hidden">
          {kind === 'image' && (
            <img src={url} alt={item.filename} className="max-w-full max-h-[80vh] object-contain rounded" />
          )}
          {kind === 'video' && (
            <video src={url} controls autoPlay className="max-w-full max-h-[80vh] rounded" />
          )}
          {kind === 'audio' && (
            <div className="w-full max-w-md p-4">
              <audio controls src={url} className="w-full" autoPlay />
            </div>
          )}
          {kind === 'model' && (
            <div className="w-[600px] h-[400px]">
              <ModelPreview src={url} filename={item.filename} />
            </div>
          )}
          {kind === 'file' && (
            <span className="text-zinc-500 text-sm">No preview available</span>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between shrink-0">
          <p className="text-xs text-zinc-400 truncate">{item.filename}</p>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={url}
              download={item.filename}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
            >
              <DownloadSimple size={12} />
              Download
            </a>
            <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors p-1.5" title="Close">
              <XCircle size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function OutputGrid({ outputs, comfyPort }: { outputs: OutputItem[]; comfyPort?: number | null }) {
  const [lightbox, setLightbox] = useState<{ item: Exclude<OutputItem, { kind: 'text' }>; url: string } | null>(null)
  const cardClass = "group flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 hover:border-emerald-500/30 transition-all duration-200 cursor-pointer"

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {outputs.map((out, i) => {
          if (out.kind === 'text') {
            return (
              <div key={i} className="col-span-2 sm:col-span-3 rounded-xl border border-white/5 bg-zinc-900/50 px-4 py-3">
                <p className="text-sm text-zinc-300 whitespace-pre-wrap font-mono-custom">{out.text}</p>
              </div>
            )
          }
          const url = resolveOutputUrl(out, comfyPort)
          const open = () => setLightbox({ item: out, url })
          if (out.kind === 'image') return (
            <div key={i} className={cardClass} onClick={open}>
              <div className="h-36 bg-zinc-950 overflow-hidden">
                <BlurRevealImage src={url} alt={out.filename} />
              </div>
              <div className="px-3 py-2 border-t border-white/5">
                <p className="text-[11px] text-zinc-500 truncate">{out.filename}</p>
              </div>
            </div>
          )
          if (out.kind === 'video') return (
            <div key={i} className={cardClass} onClick={open}>
              <video src={url} className="w-full aspect-video bg-zinc-950" />
              <div className="px-3 py-2 border-t border-white/5">
                <p className="text-[11px] text-zinc-500 truncate">{out.filename}</p>
              </div>
            </div>
          )
          if (out.kind === 'audio') return (
            <div key={i} className={cardClass} onClick={open}>
              <div className="px-4 py-4 bg-zinc-950">
                <audio src={url} className="w-full" />
              </div>
              <div className="px-3 py-2 border-t border-white/5">
                <p className="text-[11px] text-zinc-500 truncate">{out.filename}</p>
              </div>
            </div>
          )
          return (
            <div key={i} className={cardClass} onClick={open}>
              <div className="h-36 bg-zinc-950 overflow-hidden">
                <ModelPreview src={url} filename={out.filename} />
              </div>
              <div className="px-3 py-2 border-t border-white/5">
                <p className="text-[11px] text-zinc-500 truncate">{out.filename}</p>
              </div>
            </div>
          )
        })}
      </div>

      {lightbox && (
        <OutputLightbox item={lightbox.item} url={lightbox.url} onClose={() => setLightbox(null)} />
      )}
    </>
  )
}

// ─── Input field ───────────────────────────────────────────────────────────────

function InputField({
  field,
  value,
  onChange,
  comfyPort,
}: {
  field: WorkflowIO
  value: unknown
  onChange: (v: unknown) => void
  comfyPort: number | null
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

  const uploadKind = inferInputUploadKind(field.nodeType)
  if (uploadKind) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400">{label}</label>
        <FileUploadInput
          kind={uploadKind}
          value={String(value ?? '')}
          comfyPort={comfyPort}
          onChange={(filename) => onChange(filename)}
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
              href={out.path.startsWith('/') ? out.path : `/api/comfy/output?path=${encodeURIComponent(out.path)}`}
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
// Node.js tab — install + fetch snippet using live input values
// ---------------------------------------------------------------------------

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="relative">
      <pre className="bg-zinc-950 border border-white/5 rounded-lg p-3 text-xs text-zinc-300 font-mono-custom overflow-x-auto whitespace-pre leading-relaxed">
        {code}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[11px] font-medium transition-colors"
      >
        {copied ? (
          <><Check size={11} className="text-emerald-400" /><span className="text-emerald-400">Copied!</span></>
        ) : (
          <><Copy size={11} />Copy</>
        )}
      </button>
    </div>
  )
}

function NodeJsTab({ toolId, inputs }: { toolId: string; inputs: Record<string, unknown> }) {
  const inputsStr = Object.keys(inputs).length === 0
    ? '{}'
    : '{\n' + Object.entries(inputs).map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`).join(',\n') + '\n}'

  const installSnippet = `npm install @flowscale/sdk`

  const snippet =
    `import { createClient, login } from '@flowscale/sdk'

const token = await login({
  baseUrl: 'http://localhost:14173',
  username: 'admin',
  password: '<your-password>',
})

const client = createClient({ baseUrl: 'http://localhost:14173', sessionToken: token })

const result = await client.tools.run('${toolId}', ${inputsStr})

// Output paths are relative — prepend baseUrl for direct access:
// client.resolveUrl(result.outputs[0].path)
console.log(result.outputs)`

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs text-zinc-500 mb-2">Install</p>
        <CopyBlock code={installSnippet} />
      </div>
      <div>
        <p className="text-xs text-zinc-500 mb-2">Run — values reflect the current form inputs</p>
        <CopyBlock code={snippet} />
      </div>
    </div>
  )
}

function HttpTab({ toolId, inputs }: { toolId: string; inputs: Record<string, unknown> }) {
  const inputsBody = Object.keys(inputs).length === 0
    ? '  "inputs": {}'
    : '  "inputs": {\n' + Object.entries(inputs).map(([k, v]) => `    "${k}": ${JSON.stringify(v)}`).join(',\n') + '\n  }'

  const runSnippet =
    `const BASE = 'http://localhost:14173'

// 1. Execute the tool
const res = await fetch(\`\${BASE}/api/tools/${toolId}/executions\`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': 'fs_session=<your-session-token>',
  },
  body: JSON.stringify({
${inputsBody}
  }),
})

const { executionId, promptId, comfyPort } = await res.json()

// 2. Poll history until complete (ComfyUI tools)
let outputs = []
while (true) {
  await new Promise(r => setTimeout(r, 2000))
  const hist = await fetch(
    \`\${BASE}/api/comfy/\${comfyPort}/history/\${promptId}\`,
    { headers: { 'Cookie': 'fs_session=<your-session-token>' } }
  ).then(r => r.json())
  const entry = hist[promptId]
  if (!entry?.status?.completed) continue
  for (const node of Object.values(entry.outputs ?? {})) {
    for (const img of node.images ?? []) {
      outputs.push(\`\${BASE}/api/comfy/\${comfyPort}/view?filename=\${img.filename}&type=output\`)
    }
  }
  break
}

console.log(outputs)`

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
        <p className="text-xs text-amber-400 leading-relaxed">
          Update <code className="bg-amber-500/10 px-1 rounded">BASE</code> if your AIOS instance is not running locally. Session tokens are obtained by logging in via <code className="bg-amber-500/10 px-1 rounded">POST /api/auth/login</code>.
        </p>
      </div>
      <div>
        <p className="text-xs text-zinc-500 mb-2">Run &amp; poll — inputs reflect current form values</p>
        <CopyBlock code={runSnippet} />
      </div>
    </div>
  )
}

function ServerLogsPanel() {
  const [logs, setLogs] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/local-inference/logs')
        const { logs: l } = await res.json() as { logs: string[] }
        setLogs(l)
      } catch { /* ignore */ }
    }
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    userScrolledUp.current = !atBottom
  }

  if (logs.length === 0) return <p className="text-xs text-zinc-600 pt-2">No server logs yet.</p>

  return (
    <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto font-mono text-[11px] text-zinc-400 leading-relaxed">
      {logs.map((line, i) => <div key={i} className="whitespace-pre-wrap">{line}</div>)}
      <div ref={bottomRef} />
    </div>
  )
}

function BottomTabs({
  tool,
  executions,
  execLoading,
  onRestore,
  effectiveComfyPort,
  comfyInstanceLabel,
}: {
  tool: Tool
  executions: Execution[]
  execLoading: boolean
  onRestore: (inputs: Record<string, unknown>) => void
  effectiveComfyPort?: number | null
  comfyInstanceLabel?: string
}) {
  const inferenceStatus = useInferenceStatus()
  const availableTabs = (['logs', 'history'] as const)
  const defaultTab = tool.engine === 'api' ? 'logs' : 'logs'
  const [tab, setTab] = useState<'history' | 'logs'>(defaultTab)

  // Auto-switch to logs when server is starting
  useEffect(() => {
    if (tool.engine === 'api' && (inferenceStatus === 'starting' || inferenceStatus === 'running')) {
      setTab('logs')
    }
  }, [inferenceStatus, tool.engine])

  return (
    <div className="h-64 flex flex-col border-t border-white/5">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-2 shrink-0">
        {availableTabs.map((t) => (
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

        {tab === 'logs' && tool.engine === 'api' && <ServerLogsPanel />}
        {tab === 'logs' && tool.engine !== 'api' && (effectiveComfyPort ?? tool.comfyPort) && (
          <ComfyLogsPanel port={(effectiveComfyPort ?? tool.comfyPort)!} instanceLabel={comfyInstanceLabel} />
        )}
        {tab === 'logs' && tool.engine !== 'api' && !(effectiveComfyPort ?? tool.comfyPort) && (
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

  // Poll executions — faster (2s) when a generation is in-flight, slower (5s) otherwise
  const hasRunningExec = useRef(false)
  const { data: executions = [], isLoading: execLoading } = useQuery<Execution[]>({
    queryKey: ['executions', id],
    queryFn: async () => {
      const res = await fetch(`/api/tools/${id}/executions`)
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: () => hasRunningExec.current ? 2000 : 5000,
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

  // ── ComfyUI instance selection ──────────────────────────────────────────────
  const { data: comfyManageData } = useQuery<{ instances: Array<{ id: string; status: string; port: number; device: string; label: string }> }>({
    queryKey: ['comfy-manage'],
    queryFn: async () => {
      const res = await fetch('/api/comfy/manage')
      if (!res.ok) return { instances: [] }
      return res.json()
    },
  })
  const { data: gpuHardwareData } = useQuery<{ gpus: Array<{ index: number; name: string; vramMB: number; backend: string }> }>({
    queryKey: ['gpu-info'],
    queryFn: async () => {
      const res = await fetch('/api/gpu')
      if (!res.ok) return { gpus: [] }
      return res.json()
    },
    staleTime: 60_000,
  })
  const comfyInstances = comfyManageData?.instances ?? []
  const runningInstances = comfyInstances.filter((i) => i.status === 'running')
  const [selectedComfyPort, setSelectedComfyPort] = useState<number | 'auto' | null>(null)
  // Default to tool's configured port or first running instance
  const effectiveComfyPort: number | null =
    selectedComfyPort === 'auto' || selectedComfyPort === null
      ? (tool?.comfyPort ?? runningInstances[0]?.port ?? null)
      : selectedComfyPort
  const comfyInstanceLabel = effectiveComfyPort
    ? comfyInstances.find((i) => i.port === effectiveComfyPort)?.label ?? `:${effectiveComfyPort}`
    : undefined

  // ── GPU/device selection for API tools ────────────────────────────────────────
  const { data: gpuData } = useQuery<{ instances: Array<{ id: string; device: string; label: string }> }>({
    queryKey: ['gpu-instances'],
    queryFn: async () => {
      const res = await fetch('/api/comfy/instances/detect')
      if (!res.ok) return { instances: [] }
      return res.json()
    },
    enabled: tool?.engine === 'api',
  })
  const gpuDevices = gpuData?.instances ?? []
  // Devices occupied by running ComfyUI instances
  const busyDevices = new Set(runningInstances.map((i) => i.device))
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  // If auto, pick the first available (non-busy) device
  const effectiveDevice = selectedDevice || (
    gpuDevices.find((d) => !busyDevices.has(d.device))?.device ?? ''
  )

  const [leftTab, setLeftTab] = useState<'form' | 'nodejs' | 'http'>('form')
  const [latestOutputs, setLatestOutputs] = useState<OutputItem[]>([])
  const sseRef = useRef<EventSource | null>(null)
  // Track the execution we kicked off (for ComfyUI SSE/polling only)
  const comfyRunRef = useRef<{ executionId: string; promptId: string; comfyPort: number; done: boolean; pollInterval?: ReturnType<typeof setInterval> | undefined } | null>(null)
  // Track execution IDs started by *this* session so we don't show other users' runs as ours
  const myExecIds = useRef(new Set<string>())

  // ── Derive running state from actual DB data ──────────────────────────────────
  // Only consider executions started by this session as "our" running state.
  const runningExecution = executions.find((e) => e.status === 'running' && myExecIds.current.has(e.id)) ?? null
  hasRunningExec.current = !!runningExecution

  // When a running execution transitions to completed, surface its outputs
  const prevRunningIdRef = useRef<string | null>(null)
  useEffect(() => {
    const curId = runningExecution?.id ?? null
    const prevId = prevRunningIdRef.current
    prevRunningIdRef.current = curId

    // Was running, now done → check if it completed with outputs
    if (prevId && !curId) {
      const finished = executions.find((e) => e.id === prevId)
      if (finished?.status === 'completed' && finished.outputsJson) {
        try {
          const items = JSON.parse(finished.outputsJson) as OutputItem[]
          setLatestOutputs(items)
        } catch { /* ignore */ }
      }
    }
  }, [runningExecution, executions])

  /** Resolve the port: pinned port if user selected one, undefined to let server auto-route. */
  const resolveComfyPort = useCallback((): number | undefined => {
    if (selectedComfyPort !== null && selectedComfyPort !== 'auto') return selectedComfyPort
    // Let the server handle auto-routing (least-busy across all users)
    return undefined
  }, [selectedComfyPort])

  const runMutation = useMutation<ExecResult, Error>({
    mutationFn: async () => {
      const pinnedPort = resolveComfyPort()
      const res = await fetch(`/api/tools/${id}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, comfyOrgApiKey: getComfyOrgApiKey() || undefined, ...(pinnedPort != null ? { comfyPort: pinnedPort } : {}), ...(effectiveDevice ? { device: effectiveDevice } : {}) }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to run')
      }
      return res.json()
    },
    onSuccess: (result) => {
      setLatestOutputs([])
      myExecIds.current.add(result.executionId)

      // API tools: fire-and-forget. The executions poll (every 2s while running)
      // detects completion/error from the DB — no client-side tracking needed.
      if (result.type === 'api') {
        qc.invalidateQueries({ queryKey: ['executions', id] })
        return
      }

      // ── ComfyUI tools: SSE + fallback polling for real-time completion ────
      const run: { executionId: string; promptId: string; comfyPort: number; done: boolean; pollInterval?: ReturnType<typeof setInterval> } = {
        executionId: result.executionId,
        promptId: result.promptId!,
        comfyPort: result.comfyPort!,
        done: false,
      }
      comfyRunRef.current = run

      const finish = async () => {
        if (run.done) return
        run.done = true
        sseRef.current?.close()
        sseRef.current = null
        if (run.pollInterval) clearInterval(run.pollInterval)

        try {
          const histRes = await fetch(`/api/comfy/${run.comfyPort}/history/${run.promptId}`)
          if (histRes.ok) {
            const hist = await histRes.json() as Record<string, {
              status?: { status_str?: string }
              outputs?: Record<string, {
                images?: { filename: string; subfolder: string }[]
                gifs?: { filename: string; subfolder: string }[]
                videos?: { filename: string; subfolder: string }[]
                audio?: { filename: string; subfolder: string }[]
                text?: string[]
                string?: string[]
              }>
            }>
            const entry = hist[run.promptId]
            const items: OutputItem[] = []
            for (const nodeOut of Object.values(entry?.outputs ?? {})) {
              for (const f of nodeOut.images ?? []) items.push({ kind: inferKind(f.filename), filename: f.filename, path: `${f.subfolder ? f.subfolder + '/' : ''}${f.filename}` })
              for (const f of nodeOut.gifs ?? []) items.push({ kind: inferKind(f.filename), filename: f.filename, path: `${f.subfolder ? f.subfolder + '/' : ''}${f.filename}` })
              for (const f of nodeOut.videos ?? []) items.push({ kind: 'video', filename: f.filename, path: `${f.subfolder ? f.subfolder + '/' : ''}${f.filename}` })
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
            await fetch(`/api/executions/${run.executionId}`, {
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
      }

      // SSE proxy for completion detection (avoids CORS on direct WS)
      const sse = new EventSource(`/api/comfy/${run.comfyPort}/ws`)
      sseRef.current = sse
      sse.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as { type: string; data?: Record<string, unknown> }
          if (msg.data?.prompt_id !== run.promptId) return
          if (msg.type === 'executing' && msg.data?.node === null) { sse.close(); finish() }
          else if (msg.type === 'execution_error') { sse.close(); finish() }
        } catch { /* ignore */ }
      }
      sse.onerror = () => { sse.close() }

      // Fallback poll
      run.pollInterval = setInterval(async () => {
        if (run.done) { clearInterval(run.pollInterval); return }
        try {
          const histRes = await fetch(`/api/comfy/${run.comfyPort}/history/${run.promptId}`)
          if (!histRes.ok) return
          const hist = await histRes.json() as Record<string, { status?: { completed?: boolean; status_str?: string } }>
          const s = hist[run.promptId]?.status
          if (s?.completed || s?.status_str === 'error') finish()
        } catch { /* ignore */ }
      }, 3000)

      setTimeout(() => {
        if (!run.done) { run.done = true; sseRef.current?.close(); sseRef.current = null; if (run.pollInterval) clearInterval(run.pollInterval) }
      }, 300_000)
    },
  })

  const [stopping, setStopping] = useState(false)

  async function handleStopInference() {
    const execId = runningExecution?.id
    if (!execId) return
    setStopping(true)
    try {
      await fetch(`/api/executions/${execId}/cancel`, { method: 'POST' })
    } finally {
      setStopping(false)
    }
  }

  const handleRestore = useCallback((restored: Record<string, unknown>) => {
    setInputs(restored)
  }, [])

  const isRunning = runMutation.isPending || !!runningExecution

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
        <button onClick={() => window.history.back()} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-zinc-100">{tool.name}</h1>
          {tool.description && (
            <p className="text-xs text-zinc-500 mt-0.5">{tool.description}</p>
          )}
        </div>
        {isRunning && (
          <button
            onClick={handleStopInference}
            disabled={stopping}
            className="flex items-center gap-2 px-3 py-2 text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-50 text-sm font-medium rounded-md transition-colors"
          >
            <Stop size={14} weight="fill" />
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
        {/* Instance selector for ComfyUI tools */}
        {tool.engine === 'comfyui' && comfyInstances.length > 0 && (
          <ComputePicker
            instances={comfyInstances}
            gpuInfo={gpuHardwareData?.gpus}
            value={selectedComfyPort}
            onChange={setSelectedComfyPort}
          />
        )}
        {/* Device selector for API tools */}
        {tool.engine === 'api' && gpuDevices.length > 0 && (
          <select
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
            className="px-2 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-md text-zinc-300 focus:outline-none focus:border-zinc-600"
          >
            <option value="">Auto</option>
            {gpuDevices.map((d) => {
              const busy = busyDevices.has(d.device)
              return (
                <option key={d.id} value={d.device} disabled={busy}>
                  {d.label}{busy ? ' — in use by ComfyUI' : ''}
                </option>
              )
            })}
          </select>
        )}
        <button
          onClick={() => runMutation.mutate()}
          disabled={isRunning || (tool.engine === 'comfyui' && runningInstances.length === 0 && !effectiveComfyPort)}
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
      {tool.engine === 'comfyui' && runningInstances.length === 0 && !effectiveComfyPort && (
        <div className="px-6 py-2.5 bg-amber-950/30 border-b border-amber-900/50 text-amber-400 text-sm">
          No running ComfyUI instance available. Start one from the Providers page.
        </div>
      )}

      {/* Local inference setup (API tools) */}
      {tool.engine === 'api' && <LocalInferenceSetup />}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup orientation="horizontal">
          {/* Left: Form / Node.js tabs */}
          <Panel defaultSize={40} minSize={25}>
            <div className="h-full flex flex-col">
              {/* Tab bar */}
              <div className="flex items-center gap-1 px-4 pt-3 pb-0 shrink-0 border-b border-white/5">
                {(['form', 'nodejs', 'http'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setLeftTab(t)}
                    className={[
                      'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                      leftTab === t
                        ? 'border-emerald-500 text-emerald-400'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300',
                    ].join(' ')}
                  >
                    {t === 'form' ? 'Form' : t === 'nodejs' ? 'Node.js' : 'HTTP'}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {leftTab === 'form' && (
                  schema.length === 0 ? (
                    <p className="text-sm text-zinc-600">No configurable inputs detected.</p>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {schema.map((field) => (
                        <InputField
                          key={`${field.nodeId}__${field.paramName}`}
                          field={field}
                          value={inputs[`${field.nodeId}__${field.paramName}`]}
                          comfyPort={tool.comfyPort}
                          onChange={(v) =>
                            setInputs((prev) => ({
                              ...prev,
                              [`${field.nodeId}__${field.paramName}`]: v,
                            }))
                          }
                        />
                      ))}
                    </div>
                  )
                )}
                {leftTab === 'nodejs' && (
                  <NodeJsTab toolId={tool.id} inputs={inputs} />
                )}
                {leftTab === 'http' && (
                  <HttpTab toolId={tool.id} inputs={inputs} />
                )}
              </div>
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
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {(expectedOutputKinds.length > 0 ? expectedOutputKinds : ['image' as const]).map((kind, i) => (
                      <OutputLoadingPlaceholder key={i} kind={kind} />
                    ))}
                  </div>
                )}

                {latestOutputs.length > 0 && (
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
                effectiveComfyPort={effectiveComfyPort}
                comfyInstanceLabel={comfyInstanceLabel}
              />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </FadeIn>
  )
}
