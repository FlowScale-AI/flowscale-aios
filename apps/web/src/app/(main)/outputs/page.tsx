'use client'

import { useCallback, useEffect, useState } from 'react'
import { ImageSquare, Clock, Hash, ArrowClockwise, X, DownloadSimple } from 'phosphor-react'
import { LottieSpinner, StaggerGrid, StaggerItem } from '@/components/ui'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SchemaField {
  nodeId: string
  paramName: string
  nodeTitle: string
  label?: string
  isInput: boolean
  enabled?: boolean
}

interface ToolRow {
  id: string
  name: string
  status: string
  comfyPort: number | null
  schemaJson: string
}

interface Execution {
  id: string
  toolId: string
  inputsJson: string
  outputsJson: string | null
  seed: number | null
  status: string
  createdAt: number
  completedAt: number | null
}

type OutputFile = { filename: string; kind: string; path?: string }
type OutputText = { text: string; kind: 'text' }
type OutputItem = OutputFile | OutputText

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferKind(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) return 'image'
  if (['gif', 'mp4', 'webm', 'avi', 'mov'].includes(ext)) return 'video'
  if (['wav', 'mp3', 'flac', 'ogg', 'aiff', 'm4a'].includes(ext)) return 'audio'
  if (['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'].includes(ext)) return 'model'
  return 'file'
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AssetsPage() {
  const [tools, setTools] = useState<ToolRow[]>([])
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [executions, setExecutions] = useState<Execution[]>([])
  const [loadingTools, setLoadingTools] = useState(true)
  const [loadingExecs, setLoadingExecs] = useState(false)
  const [lightbox, setLightbox] = useState<{ item: OutputItem; url: string | null; exec: Execution; schema: SchemaField[]; comfyPort: number | null } | null>(null)

  // Fetch all tools
  useEffect(() => {
    fetch('/api/tools')
      .then((r) => r.json())
      .then((data: ToolRow[]) => {
        setTools(data)
        if (data.length > 0) setSelectedToolId(data[0].id)
      })
      .finally(() => setLoadingTools(false))
  }, [])

  // Fetch executions for selected tool
  const fetchExecutions = useCallback(async (toolId: string) => {
    setLoadingExecs(true)
    try {
      const r = await fetch(`/api/tools/${toolId}/executions`)
      const data: Execution[] = await r.json()
      setExecutions(data.filter((e) => e.status === 'completed' && e.outputsJson))
    } finally {
      setLoadingExecs(false)
    }
  }, [])

  useEffect(() => {
    if (selectedToolId) fetchExecutions(selectedToolId)
  }, [selectedToolId, fetchExecutions])

  const selectedTool = tools.find((t) => t.id === selectedToolId)

  // Flatten all outputs from all executions
  const allOutputs: Array<{ exec: Execution; item: OutputItem; tool: ToolRow }> = []
  for (const exec of executions) {
    if (!exec.outputsJson || !selectedTool) continue
    try {
      const items: OutputItem[] = JSON.parse(exec.outputsJson)
      for (const item of items) {
        allOutputs.push({ exec, item, tool: selectedTool })
      }
    } catch { /* skip */ }
  }

  return (
    <div className="flex h-full">
      {/* Left sidebar - tool list */}
      <div className="w-56 shrink-0 border-r border-white/5 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between shrink-0">
          <span className="text-xs text-zinc-500">{tools.length} tools</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingTools && (
            <div className="flex items-center justify-center py-8"><LottieSpinner size={18} /></div>
          )}
          {!loadingTools && tools.length === 0 && (
            <p className="text-xs text-zinc-600 px-4 py-6 text-center">No tools yet</p>
          )}
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setSelectedToolId(tool.id)}
              className={[
                'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-white/5',
                selectedToolId === tool.id ? 'bg-white/5' : 'hover:bg-zinc-800/50',
              ].join(' ')}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">{tool.name}</span>
                  <span className={[
                    'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0',
                    tool.status === 'production'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-zinc-700/50 text-zinc-500',
                  ].join(' ')}>
                    {tool.status === 'production' ? 'prod' : 'dev'}
                  </span>
                </div>
              </div>
              {selectedToolId === tool.id && (
                <div className="w-1 h-4 rounded-full bg-emerald-500 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right panel - output grid */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 shrink-0 flex items-center gap-3">
          <ImageSquare size={18} weight="duotone" className="text-emerald-400" />
          <h1 className="text-sm font-semibold text-zinc-100">
            {selectedTool ? `${selectedTool.name} Assets` : 'Assets'}
          </h1>
          <span className="text-xs text-zinc-500">
            {allOutputs.length} {allOutputs.length === 1 ? 'output' : 'outputs'}
          </span>
          {selectedToolId && (
            <button
              onClick={() => fetchExecutions(selectedToolId)}
              className="ml-auto text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Refresh"
            >
              <ArrowClockwise size={14} />
            </button>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loadingExecs && (
            <div className="flex items-center justify-center py-16"><LottieSpinner size={24} /></div>
          )}

          {!loadingExecs && !selectedToolId && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-600">
              <ImageSquare size={32} />
              <p className="text-sm">Select a tool to view outputs</p>
            </div>
          )}

          {!loadingExecs && selectedToolId && allOutputs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-600">
              <ImageSquare size={32} />
              <p className="text-sm">No completed outputs yet</p>
              <p className="text-xs text-zinc-700">Run the tool to generate outputs</p>
            </div>
          )}

          {!loadingExecs && allOutputs.length > 0 && (
            <StaggerGrid className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {allOutputs.map(({ exec, item, tool }, i) => (
                <StaggerItem key={`${exec.id}-${i}`}>
                  <OutputCard item={item} exec={exec} comfyPort={tool.comfyPort} onClick={() => {
                    let schema: SchemaField[] = []
                    try { schema = JSON.parse(tool.schemaJson || '[]') } catch { /* skip */ }
                    const file = 'filename' in item ? item as OutputFile : null
                    const url = file && tool.comfyPort
                      ? `/api/comfy/${tool.comfyPort}/view?filename=${encodeURIComponent(file.filename)}&type=output`
                      : null
                    setLightbox({ item, url, exec, schema, comfyPort: tool.comfyPort })
                  }} />
                </StaggerItem>
              ))}
            </StaggerGrid>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && <DetailPanel lightbox={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}

// ─── Output Card ──────────────────────────────────────────────────────────────

function OutputCard({
  item,
  exec,
  comfyPort,
  onClick,
}: {
  item: OutputItem
  exec: Execution
  comfyPort: number | null
  onClick: () => void
}) {
  const cardClass = "group flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 hover:border-emerald-500/30 hover:shadow-xl hover:shadow-emerald-900/10 transition-all duration-200 text-left w-full cursor-pointer"

  if (item.kind === 'text') {
    return (
      <button onClick={onClick} className={cardClass}>
        <div className="h-36 bg-zinc-950 px-3 py-3 overflow-hidden">
          <p className="text-xs text-zinc-400 font-mono leading-relaxed line-clamp-6">
            {(item as OutputText).text}
          </p>
        </div>
        <div className="px-3 py-2 bg-[#18181b] border-t border-white/5">
          <p className="text-[10px] text-zinc-500 flex items-center gap-2">
            <Clock size={10} /> {timeAgo(exec.createdAt)}
          </p>
        </div>
      </button>
    )
  }

  const file = item as OutputFile
  const kind = file.kind || inferKind(file.filename)
  const url = comfyPort
    ? `/api/comfy/${comfyPort}/view?filename=${encodeURIComponent(file.filename)}&type=output`
    : null

  if (kind === 'image' && url) {
    return (
      <button onClick={onClick} className={cardClass}>
        <div className="relative h-36 bg-zinc-950 overflow-hidden">
          <img
            src={url}
            alt={file.filename}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        </div>
        <div className="px-3 py-2 bg-[#18181b] border-t border-white/5">
          <p className="text-xs text-zinc-300 truncate mb-1">{file.filename}</p>
          <p className="text-[10px] text-zinc-500 flex items-center gap-2">
            <Clock size={10} /> {timeAgo(exec.createdAt)}
          </p>
        </div>
      </button>
    )
  }

  if (kind === 'video' && url) {
    return (
      <button onClick={onClick} className={cardClass}>
        <div className="relative h-36 bg-zinc-950 overflow-hidden">
          <video src={url} className="w-full h-full object-cover" muted loop onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }} />
        </div>
        <div className="px-3 py-2 bg-[#18181b] border-t border-white/5">
          <p className="text-xs text-zinc-300 truncate mb-1">{file.filename}</p>
          <p className="text-[10px] text-zinc-500 flex items-center gap-2">
            <Clock size={10} /> {timeAgo(exec.createdAt)}
          </p>
        </div>
      </button>
    )
  }

  if (kind === 'audio' && url) {
    return (
      <button onClick={onClick} className={cardClass}>
        <div className="h-36 bg-zinc-950 flex items-center justify-center px-3">
          <audio controls src={url} className="w-full" onClick={(e) => e.stopPropagation()} />
        </div>
        <div className="px-3 py-2 bg-[#18181b] border-t border-white/5">
          <p className="text-xs text-zinc-300 truncate mb-1">{file.filename}</p>
          <p className="text-[10px] text-zinc-500 flex items-center gap-2">
            <Clock size={10} /> {timeAgo(exec.createdAt)}
          </p>
        </div>
      </button>
    )
  }

  // Text/file fallback
  if (kind === 'file' && url) {
    return <TextFileCard url={url} filename={file.filename} exec={exec} onClick={onClick} />
  }

  // Model files
  return (
    <button onClick={onClick} className={cardClass}>
      <div className="h-36 bg-zinc-950 flex items-center justify-center">
        <span className="text-2xl text-zinc-700">{'\u2B21'}</span>
      </div>
      <div className="px-3 py-2 bg-[#18181b] border-t border-white/5">
        <p className="text-xs text-zinc-300 truncate mb-1">{file.filename}</p>
        <p className="text-[10px] text-zinc-500 flex items-center gap-2">
          <Clock size={10} /> {timeAgo(exec.createdAt)}
        </p>
      </div>
    </button>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  lightbox,
  onClose,
}: {
  lightbox: { item: OutputItem; url: string | null; exec: Execution; schema: SchemaField[]; comfyPort: number | null }
  onClose: () => void
}) {
  const item = lightbox.item
  const isText = item.kind === 'text'
  const file = !isText ? (item as OutputFile) : null
  const kind = file ? (file.kind || inferKind(file.filename)) : 'text'
  const filename = file?.filename ?? 'Text output'
  const url = lightbox.url

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div className="relative flex bg-zinc-900 rounded-xl overflow-hidden max-w-[90vw] max-h-[90vh] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Content preview */}
        <div className="flex-1 min-w-0 flex items-center justify-center bg-black p-4">
          {kind === 'image' && url && (
            <img src={url} alt={filename} className="max-w-full max-h-[80vh] object-contain rounded" />
          )}
          {kind === 'video' && url && (
            <video src={url} controls className="max-w-full max-h-[80vh] rounded" />
          )}
          {kind === 'audio' && url && (
            <div className="w-full max-w-md">
              <audio controls src={url} className="w-full" />
            </div>
          )}
          {isText && (
            <div className="w-full max-w-lg max-h-[80vh] overflow-auto p-6">
              <p className="text-sm text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap">
                {(item as OutputText).text}
              </p>
            </div>
          )}
          {kind === 'file' && url && <DetailTextFile url={url} />}
          {kind === 'model' && (
            <span className="text-5xl text-zinc-600">{'\u2B21'}</span>
          )}
        </div>

        {/* Info panel */}
        <div className="w-72 shrink-0 border-l border-white/5 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <p className="text-xs text-zinc-300 font-medium truncate">{filename}</p>
            <div className="flex items-center gap-1 shrink-0">
              {url && file && (
                <a href={url} download={file.filename} className="text-zinc-500 hover:text-white transition-colors p-1" title="Download">
                  <DownloadSimple size={14} />
                </a>
              )}
              <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors p-1" title="Close">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-white/5 flex flex-col gap-1.5">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Metadata</p>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Clock size={11} /> {timeAgo(lightbox.exec.createdAt)}
            </div>
            {lightbox.exec.seed != null && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Hash size={11} /> Seed: {lightbox.exec.seed}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Workflow Inputs</p>
            <WorkflowInputs exec={lightbox.exec} schema={lightbox.schema} />
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailTextFile({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    fetch(url).then((r) => r.text()).then(setText).catch(() => setText('(failed to load)'))
  }, [url])
  return (
    <div className="w-full max-w-lg max-h-[80vh] overflow-auto p-6">
      <p className="text-sm text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap">
        {text ?? 'Loading...'}
      </p>
    </div>
  )
}

// ─── Workflow Inputs ──────────────────────────────────────────────────────────

function WorkflowInputs({ exec, schema }: { exec: Execution; schema: SchemaField[] }) {
  let inputs: Record<string, unknown> = {}
  try { inputs = JSON.parse(exec.inputsJson || '{}') } catch { /* skip */ }

  const inputFields = schema.filter((f) => f.isInput && f.enabled !== false)

  if (inputFields.length === 0 && Object.keys(inputs).length === 0) {
    return <p className="text-xs text-zinc-600">No input data</p>
  }

  // Build a map from input key (nodeId__paramName) to schema field for label lookup
  const fieldMap = new Map<string, SchemaField>()
  for (const f of inputFields) {
    fieldMap.set(`${f.nodeId}__${f.paramName}`, f)
  }

  // Show all inputs from the execution, using schema labels where available
  const entries = Object.entries(inputs).filter(([k]) => k !== 'seed')

  if (entries.length === 0) {
    return <p className="text-xs text-zinc-600">No input data</p>
  }

  return (
    <div className="flex flex-col gap-2.5">
      {entries.map(([key, value]) => {
        const field = fieldMap.get(key)
        const label = field
          ? (field.label || field.nodeTitle || field.paramName)
          : key.replace(/__/g, ' → ')
        const display = typeof value === 'string' ? value : JSON.stringify(value)
        return (
          <div key={key}>
            <p className="text-[10px] text-zinc-500 mb-0.5">{label}</p>
            <p className="text-xs text-zinc-300 break-words leading-relaxed">{display || '(empty)'}</p>
          </div>
        )
      })}
    </div>
  )
}

// ─── Text File Card ───────────────────────────────────────────────────────────

function TextFileCard({ url, filename, exec, onClick }: { url: string; filename: string; exec: Execution; onClick: () => void }) {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then((t) => setText(t))
      .catch(() => setText('(failed to load)'))
  }, [url])

  return (
    <button onClick={onClick} className="group flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 hover:border-emerald-500/30 hover:shadow-xl hover:shadow-emerald-900/10 transition-all duration-200 text-left w-full cursor-pointer">
      <div className="h-36 bg-zinc-950 px-3 py-3 overflow-hidden">
        <p className="text-xs text-zinc-400 font-mono leading-relaxed line-clamp-6">
          {text ?? 'Loading...'}
        </p>
      </div>
      <div className="px-3 py-2 bg-[#18181b] border-t border-white/5">
        <p className="text-xs text-zinc-300 truncate mb-1">{filename}</p>
        <p className="text-[10px] text-zinc-500 flex items-center gap-2">
          <Clock size={10} /> {timeAgo(exec.createdAt)}
        </p>
      </div>
    </button>
  )
}
