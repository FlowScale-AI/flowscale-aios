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
  ShareNetwork,
  X,
} from 'phosphor-react'
import { LottieSpinner, FadeIn, StaggerGrid, StaggerItem } from '@/components/ui'
import { ComputeDropdown, type ComputeGroup } from '@/components/ComputeDropdown'
import { ComfyLogsPanel } from '@/components/ComfyLogsPanel'
import { getComfyOrgApiKey } from '@/lib/platform'
import { FileUploadInput, inferInputUploadKind } from '@/components/FileUploadInput'
import { useModalStatus } from '@/hooks/useModalStatus'
import { ComputeBanner, type LocalComputeItem, useInferenceServer, useInferenceStatusOnly } from '@/components/ComputeBanner'
import { useModalDeployStatus, useModalLogs } from '@/hooks/useModalDeployStatus'
import { useModalComfyInstances } from '@/hooks/useModalComfyInstances'
import { useBatchQueue, type ComputeTarget, type BatchJob } from '@/hooks/useBatchQueue'
import { BatchJobRack, type BatchJobView } from '@/components/BatchJobRack'

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
  workflowJson: string
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
  type?: 'api' | 'comfyui' | 'modal'
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

function OutputLoadingPlaceholder({ kind, onCancel }: { kind: 'image' | 'video' | 'audio' | 'model' | 'text' | 'file'; onCancel?: () => void }) {
  if (kind === 'text') {
    return (
      <div className="col-span-2 sm:col-span-3 rounded-xl border border-white/5 bg-zinc-900/50 px-4 py-3 flex flex-col gap-2 relative group">
        {onCancel && (
          <button
            onClick={onCancel}
            className="absolute top-2 right-2 p-1 rounded-md bg-zinc-800/80 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-all z-10"
            title="Stop generation"
          >
            <X size={14} />
          </button>
        )}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-3 rounded bg-zinc-800 animate-pulse" style={{ width: `${70 - i * 15}%`, animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 relative group">
      {onCancel && (
        <button
          onClick={onCancel}
          className="absolute top-2 right-2 p-1 rounded-md bg-zinc-800/80 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-all z-10"
          title="Stop generation"
        >
          <X size={14} />
        </button>
      )}
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
  // Prefer saved local path (set by saveOutputsToDisk after execution completes)
  if (out.path?.startsWith('/')) return out.path
  // Standard ComfyUI proxy URL
  if (out.path && !out.path.startsWith('/')) {
    const subfolder = out.path.includes('/') ? out.path.substring(0, out.path.lastIndexOf('/')) : ''
    return `/api/comfy/${comfyPort}/view?filename=${encodeURIComponent(out.filename)}${subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : ''}&type=output`
  }
  return `/api/comfy/${comfyPort}/view?filename=${encodeURIComponent(out.filename || '')}&type=output`
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
          // Show loading placeholder while waiting for disk-saved path (e.g. Modal outputs)
          const isSaving = !out.path?.startsWith('/') && (!comfyPort || url.includes('/null/'))
          const open = () => !isSaving && setLightbox({ item: out, url })
          if (out.kind === 'image') return (
            <div key={i} className={cardClass} onClick={open}>
              <div className="h-36 bg-zinc-950 overflow-hidden">
                {isSaving ? (
                  <div className="w-full h-full flex items-center justify-center relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 to-zinc-950 animate-pulse" />
                    <div className="relative flex flex-col items-center gap-1.5">
                      <LottieSpinner size={20} />
                      <span className="text-[10px] text-zinc-600">Saving output…</span>
                    </div>
                  </div>
                ) : (
                  <BlurRevealImage src={url} alt={out.filename} />
                )}
              </div>
              <div className="px-3 py-2 border-t border-white/5">
                <p className="text-[11px] text-zinc-500 truncate">{out.filename}</p>
              </div>
            </div>
          )
          if (out.kind === 'video') return (
            <div key={i} className={cardClass} onClick={open}>
              {isSaving ? (
                <div className="w-full aspect-video bg-zinc-950 flex items-center justify-center">
                  <LottieSpinner size={20} />
                </div>
              ) : (
                <video src={url} className="w-full aspect-video bg-zinc-950" />
              )}
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

  const uploadKind = inferInputUploadKind(field.nodeType) ?? (field.paramType === 'image' ? 'image' : null)
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
  onView,
  onCancel,
  isActive,
}: {
  exec: Execution
  onRestore: (inputs: Record<string, unknown>) => void
  onView: (execId: string, outputs: OutputItem[]) => void
  onCancel?: (execId: string) => void
  isActive: boolean
}) {
  const date = new Date(exec.createdAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const elapsed = exec.completedAt
    ? `${((exec.completedAt - exec.createdAt) / 1000).toFixed(1)}s`
    : null

  const outputs = exec.outputsJson
    ? (() => {
        try {
          const parsed = JSON.parse(exec.outputsJson) as { kind?: string; filename?: string; path?: string; text?: string }[]
          return parsed
            .map((o) => {
              if (o.text) return { kind: 'text' as const, text: o.text }
              if (!o.filename) return null
              const kind = (o.kind || inferKind(o.filename)) as 'image' | 'video' | 'audio' | 'model' | 'file'
              return { kind, filename: o.filename, path: o.path ?? '' }
            })
            .filter((o): o is OutputItem => o !== null)
        } catch { return [] }
      })()
    : []

  const inputs: Record<string, unknown> = (() => {
    if (!exec.inputsJson) return {}
    try { return JSON.parse(exec.inputsJson) as Record<string, unknown> }
    catch { return {} }
  })()

  const hasViewableOutputs = exec.status === 'completed' && outputs.length > 0
  const isClickable = hasViewableOutputs || exec.status === 'running'

  return (
    <div
      onClick={() => {
        if (exec.status === 'running') {
          // Show loading placeholders for this running execution
          onView(exec.id, [])
        } else if (hasViewableOutputs) {
          onView(exec.id, outputs)
        }
      }}
      className={[
        'border rounded-lg p-3 flex flex-col gap-2 transition-all',
        isClickable ? 'cursor-pointer hover:border-emerald-500/30' : '',
        isActive ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/5',
      ].join(' ')}
    >
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
        {exec.status === 'queued' && (
          <Clock size={14} className="text-zinc-500 shrink-0" />
        )}
        <span className="text-xs text-zinc-400 flex-1">{date}</span>
        {elapsed && <span className="text-xs text-zinc-600">{elapsed}</span>}
        {exec.status === 'queued' && onCancel && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(exec.id) }}
            title="Cancel queued job"
            className="text-zinc-600 hover:text-red-400 transition-colors"
          >
            <XCircle size={14} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRestore(inputs) }}
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
          {outputs.filter((o): o is Exclude<OutputItem, { kind: 'text' }> => o.kind !== 'text').map((out) => {
            const url = resolveOutputUrl(out)
            const hasLocalPath = out.path?.startsWith('/')
            if (hasLocalPath && out.kind === 'image') {
              return (
                <img
                  key={out.filename}
                  src={url}
                  alt={out.filename}
                  className="h-16 rounded border border-white/10 object-cover"
                  loading="lazy"
                />
              )
            }
            if (hasLocalPath && out.kind === 'video') {
              return (
                <video
                  key={out.filename}
                  src={url}
                  className="h-16 rounded border border-white/10 object-cover"
                  muted
                  preload="metadata"
                />
              )
            }
            return (
              <span
                key={out.filename}
                className="flex items-center gap-1 px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400"
              >
                <ImageSquare size={11} />
                {out.filename}
              </span>
            )
          })}
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

function ModalLogsPanel({ logs }: { logs: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevLengthRef = useRef(0)

  useEffect(() => {
    // Auto-scroll to bottom when new content arrives
    if (logs.length > prevLengthRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevLengthRef.current = logs.length
  }, [logs])

  return (
    <div ref={containerRef} className="h-full overflow-y-auto font-mono text-[11px] text-zinc-400 leading-relaxed">
      {logs.split('\n').map((line, i) => <div key={i} className="whitespace-pre-wrap">{line}</div>)}
      <div ref={bottomRef} />
    </div>
  )
}

function BottomTabs({
  tool,
  executions,
  execLoading,
  onRestore,
  onViewOutputs,
  onCancelExecution,
  activeExecId,
  effectiveComfyPort,
  comfyInstanceLabel,
  isModalSelected,
  pluginId,
  hasActiveJobs,
}: {
  tool: Tool
  executions: Execution[]
  execLoading: boolean
  onRestore: (inputs: Record<string, unknown>) => void
  onViewOutputs: (execId: string, outputs: OutputItem[]) => void
  onCancelExecution?: (execId: string) => void
  activeExecId: string | null
  effectiveComfyPort?: number | null
  comfyInstanceLabel?: string
  isModalSelected?: boolean
  pluginId?: string | null
  hasActiveJobs?: boolean
}) {
  const inferenceStatus = useInferenceStatusOnly()
  const availableTabs = (['logs', 'history'] as const)
  const defaultTab = tool.engine === 'api' ? 'logs' : 'logs'
  const [tab, setTab] = useState<'history' | 'logs'>(defaultTab)

  // Only fetch Modal logs when user is on the logs tab AND modal is selected
  const { data: modalLogsData } = useModalLogs(
    pluginId ?? null,
    tab === 'logs' && !!isModalSelected,
  )
  const modalLogs = modalLogsData?.logs

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
                  <ExecutionHistoryItem
                    key={exec.id}
                    exec={exec}
                    onRestore={onRestore}
                    onView={onViewOutputs}
                    onCancel={onCancelExecution}
                    isActive={exec.id === activeExecId}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'logs' && tool.engine === 'api' && isModalSelected && modalLogs && (
          <ModalLogsPanel logs={modalLogs} />
        )}
        {tab === 'logs' && tool.engine === 'api' && isModalSelected && !modalLogs && (
          <p className="text-xs text-zinc-600 pt-2">No Modal logs yet.</p>
        )}
        {tab === 'logs' && tool.engine === 'api' && !isModalSelected && <ServerLogsPanel />}
        {tab === 'logs' && tool.engine !== 'api' && effectiveComfyPort && (
          <ComfyLogsPanel port={effectiveComfyPort} instanceLabel={comfyInstanceLabel} isRunning={hasActiveJobs} />
        )}
        {tab === 'logs' && tool.engine !== 'api' && !effectiveComfyPort && (
          <p className="text-xs text-zinc-600 pt-2">No ComfyUI instance configured.</p>
        )}
      </div>
    </div>
  )
}

export default function ToolPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: currentUser } = useQuery<{ role: string }>({
    queryKey: ['current-user'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me')
      if (!res.ok) return { role: '' }
      return res.json()
    },
  })
  const isArtist = currentUser?.role === 'artist'

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

  const allSchema: WorkflowIO[] = (() => {
    if (!tool?.schemaJson) return []
    try { return JSON.parse(tool.schemaJson) as WorkflowIO[] }
    catch { return [] }
  })()
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
  const { data: modalStatus } = useModalStatus()
  const { data: modalComfyData } = useModalComfyInstances()
  const modalComfyInstances = modalComfyData?.instances ?? []
  const infServer = useInferenceServer(undefined, tool?.engine === 'api')
  const inferenceStatus = infServer.status

  // Derive pluginId from API-engine tool's workflowJson
  const pluginId = (() => {
    if (tool?.engine !== 'api') return null
    try {
      return (JSON.parse(tool.workflowJson) as { pluginId?: string }).pluginId ?? null
    } catch { return null }
  })()

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
  const busyDevices = new Set(runningInstances.map((i) => i.device))

  // ── Unified "Run on" selection ─────────────────────────────────────────────────
  // Values: "auto" (local auto), "local:{port|device}" (specific local), "modal:auto", "modal:{id|port}"
  const STORAGE_KEY = `flowscale-tool-compute-${id}`
  const [runOn, setRunOnState] = useState<string>('auto')
  const runOnInitialized = useRef(false)

  // Load persisted value once tool + instances are ready
  useEffect(() => {
    if (runOnInitialized.current || !tool) return
    runOnInitialized.current = true
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        setRunOnState(saved)
        return
      }
    } catch { /* ignore */ }
    // Default: check tool's preferred compute if set
    const wf = tool.workflowJson ? (() => { try { return JSON.parse(tool.workflowJson) } catch { return null } })() : null
    if (wf?.preferredCompute === 'modal') {
      setRunOnState('modal:auto')
    }
  }, [tool, STORAGE_KEY])

  const setRunOn = useCallback((value: string) => {
    setRunOnState(value)
    try { localStorage.setItem(STORAGE_KEY, value) } catch { /* ignore */ }
  }, [STORAGE_KEY])

  // Derive provider/target from runOn
  const isAllSelected = runOn === 'all:auto'
  const isModalSelected = runOn.startsWith('modal:') || isAllSelected
  const selectedProvider: 'local' | 'modal' = runOn.startsWith('modal:') ? 'modal' : 'local'
  const selectedTarget = runOn === 'auto' || runOn === 'all:auto' ? '' : runOn.includes(':') ? runOn.split(':').slice(1).join(':') : runOn

  // Always fetch to get `supported` flag for showing Modal button
  const { data: modalDeployData } = useModalDeployStatus(pluginId, isModalSelected ? selectedTarget : undefined)
  const modalSupported = modalDeployData?.supported ?? false

  // Modal logs are fetched inside BottomTabs only when the logs tab is active

  // Effective device for API tools
  const effectiveDevice = !isModalSelected
    ? (selectedTarget || (gpuDevices.find((d) => !busyDevices.has(d.device))?.device ?? ''))
    : ''

  // Effective ComfyUI port
  const effectiveComfyPort: number | null = (() => {
    if (tool?.engine === 'comfyui' && isModalSelected) {
      const target = selectedTarget === 'auto' ? '' : selectedTarget
      return target ? Number(target) : (modalComfyInstances.find(i => i.status === 'deployed')?.virtualPort ?? null)
    }
    if (tool?.engine === 'comfyui') {
      return selectedTarget ? Number(selectedTarget) : (tool?.comfyPort ?? runningInstances[0]?.port ?? null)
    }
    // API-engine tools
    if (isModalSelected) return null
    return tool?.comfyPort ?? runningInstances[0]?.port ?? null
  })()
  const comfyInstanceLabel = effectiveComfyPort
    ? comfyInstances.find((i) => i.port === effectiveComfyPort)?.label ?? `:${effectiveComfyPort}`
    : undefined

  const [leftTab, setLeftTab] = useState<'form' | 'nodejs' | 'http'>('form')
  const [latestOutputs, setLatestOutputs] = useState<OutputItem[]>([])
  const [latestExecId, setLatestExecId] = useState<string | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  // Track the execution we kicked off (for ComfyUI SSE/polling only)
  const comfyRunRef = useRef<{ executionId: string; promptId: string; comfyPort: number; done: boolean; pollInterval?: ReturnType<typeof setInterval> | undefined } | null>(null)
  // Track batch ComfyUI runs by execId so we can stop their polls when the DB detects completion
  const batchComfyRunsRef = useRef<Map<string, { done: boolean; pollInterval?: ReturnType<typeof setInterval>; sse?: EventSource }>>(new Map())
  // Track execution IDs started by *this* session so we don't show other users' runs as ours
  const myExecIds = useRef(new Set<string>())
  const outputPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      sseRef.current?.close()
      sseRef.current = null
      if (comfyRunRef.current?.pollInterval) {
        clearInterval(comfyRunRef.current.pollInterval)
      }
      if (comfyRunRef.current) {
        comfyRunRef.current.done = true
      }
      // Clean up all batch ComfyUI polls on unmount
      for (const run of batchComfyRunsRef.current.values()) {
        run.done = true
        if (run.pollInterval) clearInterval(run.pollInterval)
        run.sse?.close()
      }
      batchComfyRunsRef.current.clear()
    }
  }, [])

  // ── Auto-select execution on page load ──────────────────────────────────────
  const didAutoSelect = useRef(false)
  useEffect(() => {
    if (didAutoSelect.current || execLoading || latestExecId) return
    // Prefer a running execution, otherwise pick the latest completed one
    const running = executions.find((e) => e.status === 'running')
    if (running) {
      setLatestExecId(running.id)
      setLatestOutputs([])
      didAutoSelect.current = true
      return
    }
    const completed = executions.find((e) => e.status === 'completed' && e.outputsJson)
    if (completed) {
      setLatestExecId(completed.id)
      try {
        const items = JSON.parse(completed.outputsJson!) as OutputItem[]
        setLatestOutputs(items)
      } catch { /* ignore */ }
      didAutoSelect.current = true
    }
  }, [executions, execLoading, latestExecId])

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

    // Was running, now done → stop ComfyUI fallback poll and surface outputs
    if (prevId && !curId) {
      // Defensively stop the ComfyUI history poll — execution is done per the DB
      if (comfyRunRef.current && comfyRunRef.current.executionId === prevId && !comfyRunRef.current.done) {
        comfyRunRef.current.done = true
        if (comfyRunRef.current.pollInterval) { clearInterval(comfyRunRef.current.pollInterval); comfyRunRef.current.pollInterval = undefined }
        sseRef.current?.close(); sseRef.current = null
      }
      const finished = executions.find((e) => e.id === prevId)
      if (finished?.status === 'completed' && finished.outputsJson) {
        try {
          const items = JSON.parse(finished.outputsJson) as OutputItem[]
          setLatestOutputs(items)
          // Poll for saved disk paths — saveOutputsToDisk downloads files asynchronously
          // after the PATCH, so outputsJson may not have `path` fields yet.
          const hasPath = items.some((it: OutputItem) => 'path' in it && (it as { path?: string }).path?.startsWith('/'))
          if (!hasPath && prevId) {
            let attempts = 0
            if (outputPollRef.current) clearInterval(outputPollRef.current)
            const poll = setInterval(async () => {
              attempts++
              try {
                const res = await fetch(`/api/executions/${prevId}`)
                if (!res.ok) return
                const exec = await res.json()
                if (exec?.outputsJson) {
                  const saved = JSON.parse(exec.outputsJson) as OutputItem[]
                  if (saved.some((s: OutputItem) => 'path' in s && (s as { path?: string }).path?.startsWith('/'))) {
                    setLatestOutputs(saved)
                    clearInterval(poll)
                    outputPollRef.current = null
                  }
                }
              } catch { /* ignore */ }
              if (attempts >= 10) { clearInterval(poll); outputPollRef.current = null }
            }, 2000)
            outputPollRef.current = poll
          }
        } catch { /* ignore */ }
      }
    }
  }, [runningExecution, executions])

  // When a history-selected running execution completes, surface its outputs
  useEffect(() => {
    if (!latestExecId) return
    // Skip if this is our own session's run (handled above)
    if (myExecIds.current.has(latestExecId)) return
    const exec = executions.find((e) => e.id === latestExecId)
    if (!exec) return
    if (exec.status === 'completed' && exec.outputsJson && latestOutputs.length === 0) {
      try {
        const items = JSON.parse(exec.outputsJson) as OutputItem[]
        setLatestOutputs(items)
        // Poll for disk-saved paths
        const hasPath = items.some((it: OutputItem) => 'path' in it && (it as { path?: string }).path?.startsWith('/'))
        if (!hasPath) {
          let attempts = 0
          if (outputPollRef.current) clearInterval(outputPollRef.current)
          const poll = setInterval(async () => {
            attempts++
            try {
              const res = await fetch(`/api/executions/${latestExecId}`)
              if (!res.ok) return
              const data = await res.json()
              if (data?.outputsJson) {
                const saved = JSON.parse(data.outputsJson) as OutputItem[]
                if (saved.some((s: OutputItem) => 'path' in s && (s as { path?: string }).path?.startsWith('/'))) {
                  setLatestOutputs(saved)
                  clearInterval(poll)
                  outputPollRef.current = null
                }
              }
            } catch { /* ignore */ }
            if (attempts >= 10) { clearInterval(poll); outputPollRef.current = null }
          }, 2000)
          outputPollRef.current = poll
        }
      } catch { /* ignore */ }
    }
  }, [latestExecId, executions, latestOutputs.length])

  useEffect(() => {
    return () => {
      if (outputPollRef.current) {
        clearInterval(outputPollRef.current)
        outputPollRef.current = null
      }
    }
  }, [])

  /** Resolve the port: pinned port if user selected one, Modal virtual port for cloud ComfyUI, undefined to let server auto-route. */
  const resolveComfyPort = useCallback((): number | 'modal' | undefined => {
    // ComfyUI-engine tools with Modal provider: use virtual port
    if (tool?.engine === 'comfyui' && isModalSelected) {
      const target = selectedTarget === 'auto' ? '' : selectedTarget
      return target
        ? Number(target)
        : (modalComfyInstances.find(i => i.status === 'deployed')?.virtualPort ?? undefined)
    }
    // ComfyUI-engine tools with local provider: use selected target port or auto-route
    if (tool?.engine === 'comfyui') {
      return selectedTarget ? Number(selectedTarget) : undefined
    }
    // API-engine tools on Modal
    if (isModalSelected) return 'modal'
    // Let the server handle auto-routing (least-busy across all users)
    return undefined
  }, [isModalSelected, selectedTarget, tool?.engine, modalComfyInstances])

  const runMutation = useMutation<ExecResult, Error>({
    mutationFn: async () => {
      const pinnedPort = resolveComfyPort()
      const res = await fetch(`/api/tools/${id}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs,
          comfyOrgApiKey: getComfyOrgApiKey() || undefined,
          ...(pinnedPort != null ? { comfyPort: pinnedPort } : {}),
          ...(selectedProvider === 'modal'
            ? { provider: 'modal', modalDeployId: selectedTarget || 'auto' }
            : effectiveDevice ? { device: effectiveDevice } : {}),
        }),
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

      // API / Modal tools: fire-and-forget. The executions poll (every 2s while running)
      // detects completion/error from the DB — no client-side tracking needed.
      if (result.type === 'api' || result.type === 'modal') {
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
        // Don't set run.done = true yet — only lock once we've successfully finished
        // so that the fallback poll can retry if the history fetch fails.

        try {
          const histRes = await fetch(`/api/comfy/${run.comfyPort}/history/${run.promptId}`)
          if (!histRes.ok) return // leave run.done = false so poll retries
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
          // Lock now — history fetched successfully, we're committing the result
          run.done = true
          sseRef.current?.close()
          sseRef.current = null
          if (run.pollInterval) clearInterval(run.pollInterval)
          setLatestOutputs(items)
          const patchRes = await fetch(`/api/executions/${run.executionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: entry?.status?.status_str === 'error' ? 'error' : 'completed',
              outputsJson: JSON.stringify(items),
              completedAt: Date.now(),
            }),
          })
          // Update with server-saved paths (PATCH downloads files and updates paths)
          if (patchRes.ok) {
            try {
              const saved = await patchRes.json()
              if (saved?.outputsJson) setLatestOutputs(JSON.parse(saved.outputsJson))
            } catch { /* keep raw items */ }
          }
          qc.invalidateQueries({ queryKey: ['executions', id] })
        } catch { /* ignore — poll will retry */ }
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

      // Fallback poll — use longer interval for Modal to avoid keeping container alive
      const isModal = run.comfyPort > 50000 && run.comfyPort <= 50999
      run.pollInterval = setInterval(async () => {
        if (run.done) { clearInterval(run.pollInterval); run.pollInterval = undefined; return }
        try {
          const histRes = await fetch(`/api/comfy/${run.comfyPort}/history/${run.promptId}`)
          if (!histRes.ok) return
          const hist = await histRes.json() as Record<string, { status?: { completed?: boolean; status_str?: string } }>
          const s = hist[run.promptId]?.status
          if (s?.completed || s?.status_str === 'success' || s?.status_str === 'error') finish()
        } catch { /* ignore */ }
      }, isModal ? 10_000 : 3000)

      setTimeout(() => {
        if (!run.done) { run.done = true; sseRef.current?.close(); sseRef.current = null; if (run.pollInterval) clearInterval(run.pollInterval); run.pollInterval = undefined }
      }, 300_000)
    },
  })

  const [stopping, setStopping] = useState(false)

  // Share URL
  const { data: networkData } = useQuery<{ ip: string | null }>({
    queryKey: ['network-ip'],
    queryFn: async () => {
      const res = await fetch('/api/network-ip')
      if (!res.ok) return { ip: null }
      return res.json()
    },
    staleTime: 300_000,
  })
  const [shareCopied, setShareCopied] = useState(false)
  const handleShareUrl = useCallback(() => {
    const ip = networkData?.ip
    if (!ip) return
    const url = `http://${ip}:14173/tools/${id}`
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    })
  }, [networkData?.ip, id])

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

  // ── Batch queue ──────────────────────────────────────────────────────────────

  const getTargets = useCallback((): ComputeTarget[] => {
    if (!tool) return []

    if (tool.engine === 'comfyui') {
      // Specific instance selected
      if (runOn.startsWith('local:')) {
        const port = Number(runOn.split(':')[1])
        const inst = comfyInstances.find((i) => i.port === port)
        if (inst && inst.status === 'running') {
          return [{ id: `local:${port}`, label: inst.label, provider: 'local', port }]
        }
        return []
      }
      if (runOn.startsWith('modal:') && runOn !== 'modal:auto') {
        const vport = Number(runOn.split(':')[1])
        const inst = modalComfyInstances.find((i) => i.virtualPort === vport)
        if (inst) return [{ id: `modal:${vport}`, label: `${inst.name} (${inst.gpu})`, provider: 'modal', port: vport }]
        return []
      }

      const localTargets: ComputeTarget[] = runningInstances.map((i) => ({
        id: `local:${i.port}`,
        label: i.label,
        provider: 'local' as const,
        port: i.port,
      }))
      const cloudTargets: ComputeTarget[] = modalComfyInstances
        .filter((i) => i.status === 'deployed')
        .map((i) => ({
          id: `modal:${i.virtualPort}`,
          label: `${i.name} (${i.gpu})`,
          provider: 'modal' as const,
          port: i.virtualPort,
        }))

      if (runOn === 'all:auto') return [...localTargets, ...cloudTargets]
      if (runOn === 'modal:auto') return cloudTargets
      // 'auto' = local auto-route
      return localTargets
    }

    // API-engine tools
    if (runOn.startsWith('local:')) {
      const device = runOn.split(':').slice(1).join(':')
      const d = gpuDevices.find((g) => g.device === device)
      if (d) return [{ id: `local:${device}`, label: d.label, provider: 'local', device }]
      return []
    }
    if (runOn.startsWith('modal:') && runOn !== 'modal:auto') {
      const deployId = runOn.split(':').slice(1).join(':')
      const dep = (modalDeployData?.deployments ?? []).find((d) => d.id === deployId)
      if (dep) return [{ id: `modal:${deployId}`, label: `${dep.name} (${dep.gpu})`, provider: 'modal', modalDeployId: deployId }]
      return []
    }

    const localApiTargets: ComputeTarget[] = gpuDevices.map((d) => ({
      id: `local:${d.device}`,
      label: d.label,
      provider: 'local' as const,
      device: d.device,
    }))
    const cloudApiTargets: ComputeTarget[] = (modalDeployData?.deployments ?? [])
      .filter((d) => d.status === 'deployed')
      .map((d) => ({
        id: `modal:${d.id}`,
        label: `${d.name} (${d.gpu})`,
        provider: 'modal' as const,
        modalDeployId: d.id,
      }))

    if (runOn === 'all:auto') return [...localApiTargets, ...cloudApiTargets]
    if (runOn === 'modal:auto') return cloudApiTargets
    return localApiTargets
  }, [tool, runOn, comfyInstances, runningInstances, modalComfyInstances, gpuDevices, modalDeployData])

  const batchDispatchJob = useCallback(async (payload: {
    inputs: Record<string, unknown>
    execId?: string
    comfyPort?: number | 'modal'
    device?: string
    provider?: 'modal'
    modalDeployId?: string
  }) => {
    const res = await fetch(`/api/tools/${id}/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: payload.inputs,
        comfyOrgApiKey: getComfyOrgApiKey() || undefined,
        ...(payload.execId ? { execId: payload.execId } : {}),
        ...(payload.comfyPort != null ? { comfyPort: payload.comfyPort } : {}),
        ...(payload.provider === 'modal'
          ? { provider: 'modal', modalDeployId: payload.modalDeployId || 'auto' }
          : payload.device ? { device: payload.device } : {}),
      }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? 'Failed to run')
    }
    const result = await res.json()
    return {
      executionId: result.executionId,
      type: result.type as 'api' | 'comfyui' | 'modal' | undefined,
      seed: result.seed,
      promptId: result.promptId,
      comfyPort: result.comfyPort,
    }
  }, [id])

  // Ref to access batch.markCompleted/markErrored from within the callback
  // (avoids circular dependency: callback → batch → callback)
  const batchRef = useRef<{ markCompleted: (execId: string, outputs: OutputItem[]) => void; markErrored: (execId: string, msg: string) => void }>({
    markCompleted: () => {},
    markErrored: () => {},
  })

  const batch = useBatchQueue({
    toolId: id,
    getTargets,
    dispatchJob: batchDispatchJob,
    onJobComplete: () => {
      qc.invalidateQueries({ queryKey: ['executions', id] })
    },
    onComfyJobStarted: useCallback((job: BatchJob, result: { executionId: string; promptId?: string; comfyPort?: number }) => {
      // Track for SSE-based completion detection
      if (!result.promptId || !result.comfyPort) return
      myExecIds.current.add(result.executionId)

      const run = {
        executionId: result.executionId,
        promptId: result.promptId,
        comfyPort: result.comfyPort,
        done: false,
        pollInterval: undefined as ReturnType<typeof setInterval> | undefined,
        sse: undefined as EventSource | undefined,
      }
      // Register in ref map so the poll can be stopped externally (e.g. when DB detects completion)
      batchComfyRunsRef.current.set(result.executionId, run)

      const finish = async () => {
        if (run.done) return
        // Don't lock yet — only set run.done after a successful history fetch
        // so the fallback poll can retry if the request fails.

        try {
          const histRes = await fetch(`/api/comfy/${run.comfyPort}/history/${run.promptId}`)
          if (!histRes.ok) return // leave run.done = false so poll retries
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

          // Lock now — history fetched successfully
          run.done = true
          if (run.pollInterval) { clearInterval(run.pollInterval); run.pollInterval = undefined }
          run.sse?.close()
          batchComfyRunsRef.current.delete(run.executionId)

          // PATCH execution to completed — server saves files to disk and returns updated paths
          const isError = entry?.status?.status_str === 'error'
          const patchRes = await fetch(`/api/executions/${run.executionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: isError ? 'error' : 'completed',
              outputsJson: JSON.stringify(items),
              completedAt: Date.now(),
            }),
          })
          let savedItems = items
          if (patchRes.ok) {
            try {
              const saved = await patchRes.json()
              if (saved?.outputsJson) savedItems = JSON.parse(saved.outputsJson)
            } catch { /* use raw items */ }
          }

          if (isError) {
            batchRef.current.markErrored(run.executionId, 'Execution failed')
          } else {
            batchRef.current.markCompleted(run.executionId, savedItems)
          }
        } catch { /* ignore — poll will retry */ }
      }

      // SSE for completion detection
      const sse = new EventSource(`/api/comfy/${run.comfyPort}/ws`)
      run.sse = sse
      sse.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as { type: string; data?: Record<string, unknown> }
          if (msg.data?.prompt_id !== run.promptId) return
          if (msg.type === 'executing' && msg.data?.node === null) { sse.close(); finish() }
          else if (msg.type === 'execution_error') { sse.close(); finish() }
        } catch { /* ignore */ }
      }
      sse.onerror = () => { sse.close() }

      // Fallback polling — use longer interval for Modal to avoid keeping container alive
      const isModal = run.comfyPort > 50000 && run.comfyPort <= 50999
      run.pollInterval = setInterval(async () => {
        if (run.done) { clearInterval(run.pollInterval); run.pollInterval = undefined; return }
        try {
          const histRes = await fetch(`/api/comfy/${run.comfyPort}/history/${run.promptId}`)
          if (!histRes.ok) return
          const hist = await histRes.json() as Record<string, { status?: { completed?: boolean; status_str?: string } }>
          const s = hist[run.promptId]?.status
          if (s?.completed || s?.status_str === 'success' || s?.status_str === 'error') finish()
        } catch { /* ignore */ }
      }, isModal ? 10_000 : 3000)

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!run.done) { run.done = true; sse.close(); if (run.pollInterval) clearInterval(run.pollInterval); run.pollInterval = undefined; batchComfyRunsRef.current.delete(run.executionId) }
      }, 300_000)
    }, []),
  })

  // Keep ref in sync with batch functions
  batchRef.current.markCompleted = batch.markCompleted
  batchRef.current.markErrored = batch.markErrored

  // Stop batch ComfyUI history polls when the DB detects completion (defensive cleanup)
  useEffect(() => {
    for (const job of batch.jobs) {
      if (job.status === 'completed' || job.status === 'error') {
        const execId = job.execId
        if (execId && batchComfyRunsRef.current.has(execId)) {
          const run = batchComfyRunsRef.current.get(execId)!
          run.done = true
          if (run.pollInterval) { clearInterval(run.pollInterval); run.pollInterval = undefined }
          run.sse?.close()
          batchComfyRunsRef.current.delete(execId)
        }
      }
    }
  }, [batch.jobs])

  const [viewingBatchJobId, setViewingBatchJobId] = useState<number | null>(null)

  // Resolve outputs for a batch job: prefer job.outputs, fall back to DB execution data
  const resolveJobOutputs = useCallback((job: BatchJobView): OutputItem[] => {
    if (job.outputs.length > 0) return job.outputs
    if (!job.execId) return []
    const exec = executions.find((e) => e.id === job.execId)
    if (!exec?.outputsJson) return []
    try {
      const parsed = JSON.parse(exec.outputsJson) as { kind?: string; filename?: string; path?: string; text?: string }[]
      return parsed
        .map((o) => {
          if (o.text) return { kind: 'text' as const, text: o.text }
          if (!o.filename) return null
          const kind = (o.kind || inferKind(o.filename)) as 'image' | 'video' | 'audio' | 'model' | 'file'
          return { kind, filename: o.filename, path: o.path ?? '' }
        })
        .filter((o): o is OutputItem => o !== null)
    } catch { return [] }
  }, [executions])

  // When a batch job is viewed, load its outputs into the output area
  const handleViewBatchJob = useCallback((job: BatchJobView) => {
    setViewingBatchJobId(job.id)
    if (job.status === 'completed') {
      const outputs = resolveJobOutputs(job)
      if (outputs.length > 0) {
        setLatestOutputs(outputs)
        setLatestExecId(job.execId ?? null)
      }
    } else if (job.status === 'running') {
      setLatestOutputs([])
      setLatestExecId(job.execId ?? null)
    }
  }, [resolveJobOutputs])

  const handleCancelBatchJob = useCallback((job: BatchJobView) => {
    if (job.status === 'running' || job.status === 'dispatching') {
      batch.cancelRunning(job.id)
    }
  }, [batch])

  // Generate a random seed
  const generateSeed = useCallback(() => Math.floor(Math.random() * 2147483647), [])

  // When a single batch job completes, show its outputs in single-output view
  useEffect(() => {
    if (batch.totalCount === 1 && batch.completedCount === 1 && latestOutputs.length === 0) {
      const job = batch.jobs[0]
      const outputs = resolveJobOutputs(job)
      if (outputs.length > 0) {
        setLatestOutputs(outputs)
        setLatestExecId(job.execId ?? null)
      }
    }
  }, [batch.totalCount, batch.completedCount, batch.jobs, latestOutputs.length, resolveJobOutputs])

  // Auto-view the latest completed batch job when no job is actively being viewed and no outputs shown
  useEffect(() => {
    if (!batch.isBatchMode || viewingBatchJobId !== null || latestOutputs.length > 0) return
    // Find the most recently completed job with outputs
    for (const job of [...batch.jobs].reverse()) {
      if (job.status !== 'completed') continue
      const outputs = resolveJobOutputs(job)
      if (outputs.length > 0) {
        setViewingBatchJobId(job.id)
        setLatestOutputs(outputs)
        setLatestExecId(job.execId ?? null)
        return
      }
    }
  }, [batch.isBatchMode, batch.jobs, viewingBatchJobId, latestOutputs.length, resolveJobOutputs, executions])

  // Handle Run click — dispatches immediately to available compute
  const handleRunClick = useCallback(() => {
    const seed = generateSeed()
    const jobInputs = { ...inputs, seed }
    // Clear single-view state when adding a job
    if (!batch.isBatchMode) {
      setLatestOutputs([])
      setLatestExecId(null)
      setViewingBatchJobId(null)
    }
    batch.run(jobInputs, seed)
  }, [inputs, batch, generateSeed])

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
        {networkData?.ip && (
          <button
            onClick={handleShareUrl}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-colors"
            title="Copy share URL"
          >
            {shareCopied ? <Check size={13} className="text-emerald-400" /> : <ShareNetwork size={13} />}
            {shareCopied ? 'Copied!' : 'Share'}
          </button>
        )}
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
        {/* Compute selector */}
        {!isArtist && (() => {
          const hasCloud = tool.engine === 'comfyui'
            ? modalComfyInstances.filter(i => i.status === 'deployed').length > 0
            : (modalSupported || isModalSelected) && modalStatus?.authenticated
          const computeGroups: ComputeGroup[] = tool.engine === 'comfyui'
            ? [
                ...(hasCloud ? [{
                  label: 'All',
                  icon: 'all' as const,
                  options: [{ value: 'all:auto', label: 'All: Auto-route' }],
                }] : []),
                {
                  label: 'Local',
                  icon: 'local',
                  options: [
                    { value: 'auto', label: 'Local: Auto-route' },
                    ...comfyInstances.map((inst) => ({
                      value: `local:${inst.port}`,
                      label: inst.label,
                      disabled: inst.status !== 'running',
                    })),
                  ],
                },
                ...(hasCloud
                  ? [{
                      label: 'Cloud (Modal)',
                      icon: 'cloud' as const,
                      options: [
                        { value: 'modal:auto', label: 'Cloud: Auto-route' },
                        ...modalComfyInstances
                          .filter(i => i.status === 'deployed')
                          .map(i => ({ value: `modal:${i.virtualPort}`, label: `${i.name} (${i.gpu})` })),
                      ],
                    }]
                  : []),
              ]
            : [
                ...(hasCloud ? [{
                  label: 'All',
                  icon: 'all' as const,
                  options: [{ value: 'all:auto', label: 'All: Auto-route' }],
                }] : []),
                {
                  label: 'Local',
                  icon: 'local',
                  options: [
                    { value: 'auto', label: 'Local: Auto-route' },
                    ...gpuDevices.map((d) => ({
                      value: `local:${d.device}`,
                      label: d.label,
                      disabled: busyDevices.has(d.device),
                    })),
                  ],
                },
                ...(hasCloud
                  ? [{
                      label: 'Cloud (Modal)',
                      icon: 'cloud' as const,
                      options: [
                        { value: 'modal:auto', label: 'Cloud: Auto-route' },
                        ...(modalDeployData?.deployments ?? [])
                          .filter(d => d.status === 'deployed')
                          .map((d) => ({ value: `modal:${d.id}`, label: `${d.name} (${d.gpu})` })),
                      ],
                    }]
                  : []),
              ]
          return <ComputeDropdown value={runOn} onChange={setRunOn} groups={computeGroups} />
        })()}
        <button
          onClick={handleRunClick}
          disabled={
            (tool.engine === 'comfyui' && selectedProvider !== 'modal' && !isAllSelected && runningInstances.length === 0 && !effectiveComfyPort)
            || !batch.hasFreeTarget()
          }
          className="relative flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold rounded-md transition-colors"
        >
          <Play size={14} weight="fill" />
          Run
          {batch.hasActiveJobs && (
            <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-emerald-500 text-white rounded-full">
              {batch.runningCount}
            </span>
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
      {tool.engine === 'comfyui' && selectedProvider !== 'modal' && runningInstances.length === 0 && !effectiveComfyPort && (
        <div className="px-6 py-2.5 bg-amber-950/30 border-b border-amber-900/50 text-amber-400 text-sm">
          No running ComfyUI instance available. Start one from the Providers page.
        </div>
      )}

      {/* Compute banner — unified for local, cloud, and all modes */}
      {(() => {
        // Determine banner mode from runOn selection
        const bannerMode: 'local' | 'cloud' | 'all' | null = (() => {
          if (isAllSelected) return 'all'
          if (runOn.startsWith('modal:')) return 'cloud'
          if (runOn === 'auto') return 'local'
          return null // specific target selected — no banner
        })()
        if (!bannerMode) return null

        // Build local compute items
        const localItems: LocalComputeItem[] = tool.engine === 'comfyui'
          ? comfyInstances.map((inst) => ({
              id: inst.id,
              label: inst.label,
              status: inst.status as 'running' | 'stopped' | 'starting',
              type: 'comfyui' as const,
              port: inst.port,
              device: inst.device,
              gpu: gpuHardwareData?.gpus?.find(g => inst.device === `cuda:${g.index}`)?.name,
            }))
          : gpuDevices.map((d) => ({
              id: d.id,
              label: d.label,
              status: (inferenceStatus === 'running' ? 'running' : inferenceStatus === 'starting' ? 'starting' : 'stopped') as 'running' | 'stopped' | 'starting',
              type: 'gpu' as const,
              device: d.device,
            }))

        // Cloud props (only for API tools with Modal support)
        const showCloudDeploy = tool.engine === 'api' && pluginId && modalSupported
        const cloudProps = showCloudDeploy ? {
          pluginId: pluginId!,
          defaultGpu: modalDeployData?.defaultGpu ?? 'A10',
          requiredSecrets: modalDeployData?.requiredSecrets,
          deployments: modalDeployData?.deployments ?? [],
          onDeployed: () => qc.invalidateQueries({ queryKey: ['modal-deploy-status', pluginId] }),
        } : {}

        // For ComfyUI cloud mode, show Modal ComfyUI instances as deployments
        const comfyCloudDeployments = tool.engine === 'comfyui'
          ? modalComfyInstances.map(i => ({
                id: i.id ?? i.name,
                name: i.name,
                status: (i.status === 'error' ? 'failed' : i.status) as 'deployed' | 'deploying' | 'failed',
                gpu: i.gpu,
                warm: null,
                url: '',
                error: i.errorMessage,
              }))
          : undefined

        // Inference server props for API tools (local/all modes)
        const infProps = tool.engine === 'api' && (bannerMode === 'local' || bannerMode === 'all')
          ? infServer.inferenceServerProps
          : undefined

        // For API tools, always show the banner (server status is useful even without compute items)
        const hasLocal = localItems.length > 0
        const hasCloud = (cloudProps.deployments?.length ?? 0) > 0 || (comfyCloudDeployments?.length ?? 0) > 0
        if (bannerMode === 'local' && !hasLocal && !infProps) return null
        if (bannerMode === 'cloud' && !hasCloud && !showCloudDeploy) return null

        return (
          <ComputeBanner
            mode={bannerMode}
            localCompute={localItems}
            {...cloudProps}
            {...(comfyCloudDeployments ? { deployments: comfyCloudDeployments } : {})}
            inferenceServer={infProps}
          />
        )
      })()}

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
              <div className="flex-1 overflow-hidden flex flex-col border-b border-white/5">
                {batch.isBatchMode ? (
                  <>
                    {/* Batch rack — compact, max ~40% height, scrollable */}
                    <div className="shrink-0 max-h-[40%] overflow-y-auto px-6 pt-5 pb-3 border-b border-white/5">
                      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                        Batch Jobs
                      </h2>
                      <BatchJobRack
                        jobs={batch.jobs}
                        viewingJobId={viewingBatchJobId}
                        onViewJob={handleViewBatchJob}
                        onCancelJob={handleCancelBatchJob}
                        onCancelAll={batch.cancelAll}
                        onClearFinished={batch.clearFinished}
                        runningCount={batch.runningCount}
                        completedCount={batch.completedCount}
                        errorCount={batch.errorCount}
                      />
                    </div>
                    {/* Output — takes remaining space */}
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                      {(() => {
                        let displayOutputs = latestOutputs
                        if (displayOutputs.length === 0) {
                          const targetJob = viewingBatchJobId !== null
                            ? batch.jobs.find((j) => j.id === viewingBatchJobId)
                            : [...batch.jobs].reverse().find((j) => j.status === 'completed')
                          if (targetJob) {
                            displayOutputs = resolveJobOutputs(targetJob)
                          }
                        }
                        if (displayOutputs.length > 0) return (
                          <>
                            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                              Output
                            </h2>
                            <OutputGrid outputs={displayOutputs} comfyPort={tool.comfyPort} />
                          </>
                        )
                        return (
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <ImageSquare size={32} weight="duotone" className="text-zinc-700 mb-3" />
                            <p className="text-sm text-zinc-600">Click a job to see its output</p>
                          </div>
                        )
                      })()}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 overflow-y-auto px-6 py-5">
                    <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                      Output
                    </h2>
                    {(() => {
                      const selectedIsRunning = latestExecId
                        ? executions.some((e) => e.id === latestExecId && e.status === 'running')
                        : false
                      const batchHasRunning = batch.totalCount === 1 && batch.runningCount > 0
                      const showLoading = (isRunning || selectedIsRunning || batchHasRunning) && latestOutputs.length === 0

                      if (showLoading) {
                        const handleCancelRunning = () => {
                          if (batchHasRunning && batch.jobs.length > 0) {
                            const runningJob = batch.jobs.find((j) => j.status === 'running' || j.status === 'dispatching')
                            if (runningJob) batch.cancelRunning(runningJob.id)
                          }
                          if (latestExecId) {
                            fetch(`/api/executions/${latestExecId}/cancel`, { method: 'POST' })
                          }
                        }
                        return (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {(expectedOutputKinds.length > 0 ? expectedOutputKinds : ['image' as const]).map((kind, i) => (
                              <OutputLoadingPlaceholder key={i} kind={kind} onCancel={i === 0 ? handleCancelRunning : undefined} />
                            ))}
                          </div>
                        )
                      }
                      if (latestOutputs.length > 0) return (
                        <OutputGrid outputs={latestOutputs} comfyPort={tool.comfyPort} />
                      )
                      return (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <ImageSquare size={32} weight="duotone" className="text-zinc-700 mb-3" />
                          <p className="text-sm text-zinc-600">Run the tool to see output here</p>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>

              {/* Run history / Logs tabs */}
              <BottomTabs
                tool={tool}
                executions={executions}
                execLoading={execLoading}
                onRestore={handleRestore}
                onViewOutputs={(execId, outputs) => {
                  setLatestOutputs(outputs)
                  setLatestExecId(execId)
                  setViewingBatchJobId(null)
                }}
                activeExecId={latestExecId}
                effectiveComfyPort={effectiveComfyPort}
                comfyInstanceLabel={comfyInstanceLabel}
                isModalSelected={isModalSelected}
                pluginId={pluginId}
                hasActiveJobs={isRunning || batch.hasActiveJobs}
                onCancelExecution={async (execId) => {
                  await fetch(`/api/executions/${execId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'error', errorMessage: 'Cancelled', completedAt: Date.now() }),
                  })
                  qc.invalidateQueries({ queryKey: ['executions', id] })
                }}
              />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </FadeIn>
  )
}
