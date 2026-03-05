'use client'

import { useCallback, useEffect, useState } from 'react'
import { Play, Warning, Monitor, Spinner } from 'phosphor-react'
import { LottieSpinner } from '@/components/ui'
import { ComfyLogsPanel } from '@/components/ComfyLogsPanel'
import { getComfyOrgApiKey } from '@/lib/platform'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowIO {
  nodeId: string
  nodeType: string
  nodeTitle: string
  paramName: string
  paramType: string
  defaultValue?: unknown
  label?: string
  options?: string[]
  isInput: boolean
  enabled?: boolean
}

export interface ToolForTest {
  id: string
  name: string
  comfyPort: number | null
  schemaJson: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferOutputKind(nodeType: string): 'image' | 'video' | 'audio' | 'model' | 'text' | 'file' {
  if (['FSSaveImage', 'SaveImage', 'PreviewImage', 'SaveAnimatedWEBP', 'SaveAnimatedPNG'].includes(nodeType)) return 'image'
  if (['FSSaveVideo', 'VHS_VideoCombine'].includes(nodeType)) return 'video'
  if (['FSSaveAudio', 'SaveAudio', 'PreviewAudio'].includes(nodeType)) return 'audio'
  if (['FSSave3D', 'FSHunyuan3DGenerate', 'Save3D', 'TripoSGSave', 'MeshSave'].includes(nodeType) || /Save.*3[Dd]|3[Dd].*Save|GLB|GLTF|Mesh/i.test(nodeType)) return 'model'
  if (['FSSaveText', 'FSSaveInteger'].includes(nodeType)) return 'text'
  return 'file'
}

// ─── Output loading placeholders ──────────────────────────────────────────────

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

// ─── Blur-reveal image ────────────────────────────────────────────────────────

function BlurRevealImage({ src, alt }: { src: string; alt: string }) {
  const [sharp, setSharp] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setSharp(true))
    )
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
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

// ─── 3-D model preview ────────────────────────────────────────────────────────

let _modelViewerLoaded = false
let _modelViewerLoading = false
function loadModelViewer(): Promise<void> {
  return new Promise((resolve) => {
    if (_modelViewerLoaded) { resolve(); return }
    if (typeof window !== 'undefined' && customElements.get('model-viewer')) {
      _modelViewerLoaded = true; resolve(); return
    }
    if (_modelViewerLoading) {
      const t = setInterval(() => { if (_modelViewerLoaded) { clearInterval(t); resolve() } }, 100)
      return
    }
    _modelViewerLoading = true
    const s = document.createElement('script')
    s.type = 'module'
    s.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js'
    s.onload = () => { _modelViewerLoaded = true; _modelViewerLoading = false; resolve() }
    s.onerror = () => { _modelViewerLoading = false; resolve() }
    document.head.appendChild(s)
  })
}

function ModelPreview({ src, filename }: { src: string; filename: string }) {
  const [ready, setReady] = useState(false)
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const isViewable = ['glb', 'gltf'].includes(ext)

  useEffect(() => {
    if (isViewable) loadModelViewer().then(() => setReady(true))
  }, [isViewable])

  if (isViewable && ready) {
    return (
      <div className="col-span-2 w-full aspect-square rounded-xl overflow-hidden border border-white/5">
        {/* @ts-ignore */}
        <model-viewer
          src={src}
          alt={filename}
          auto-rotate
          camera-controls
          style={{ width: '100%', height: '100%', background: '#18181b' }}
        />
      </div>
    )
  }

  return (
    <a
      href={src}
      download={filename}
      className="col-span-2 flex items-center gap-3 px-4 py-3 rounded-xl border border-white/5 bg-zinc-900 hover:bg-zinc-800 transition-colors"
    >
      <Spinner size={16} className="text-violet-400" />
      <span className="text-sm text-zinc-300 flex-1 truncate">{filename}</span>
      <span className="text-xs text-zinc-600">Download 3D</span>
    </a>
  )
}

// ─── Main Test Playground ─────────────────────────────────────────────────────

export function ToolTestPlayground({ tool }: { tool: ToolForTest }) {
  const allSchema: WorkflowIO[] = tool.schemaJson ? JSON.parse(tool.schemaJson) : []
  const schema: WorkflowIO[] = allSchema
    .filter((f) => f.isInput && f.enabled !== false)
    .filter((f) => !(f.paramName === 'label' && f.nodeType.startsWith('FS')))
  const expectedOutputKinds: Array<'image' | 'video' | 'audio' | 'model' | 'text' | 'file'> =
    allSchema.filter((f) => !f.isInput && f.enabled !== false).map((f) => inferOutputKind(f.nodeType))

  const [inputs, setInputs] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {}
    for (const f of schema) {
      defaults[`${f.nodeId}__${f.paramName}`] = f.defaultValue ?? ''
    }
    return defaults
  })

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  type OutputFile = { filename: string; kind: 'image' | 'video' | 'audio' | 'model' | 'file' }
  type OutputText = { text: string; kind: 'text' }
  type OutputItem = OutputFile | OutputText
  const [outputs, setOutputs] = useState<OutputItem[]>([])
  const [execMeta, setExecMeta] = useState<{ seed: number; elapsed: string } | null>(null)
  const [error, setError] = useState<string[]>([])
  const [logsOpen, setLogsOpen] = useState(false)

  const handleRun = useCallback(async () => {
    setRunning(true)
    setProgress(0)
    setOutputs([])
    setError([])
    setExecMeta(null)
    const startTime = Date.now()

    try {
      const res = await fetch(`/api/tools/${tool.id}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, comfyOrgApiKey: getComfyOrgApiKey() || undefined }),
      })
      if (!res.ok) {
        const err = await res.json()
        const lines: string[] = err.error
          ? String(err.error).split('\n').filter(Boolean)
          : ['Run failed']
        setError(lines)
        setRunning(false)
        return
      }

      const result = await res.json() as {
        executionId: string
        promptId: string
        comfyPort: number
        seed: number
      }

      let done = false

      const finish = async (failed = false) => {
        if (done) return
        done = true

        if (failed) {
          setError(['Execution failed'])
          setRunning(false)
          return
        }

        try {
          const histRes = await fetch(`/api/comfy/${result.comfyPort}/history/${result.promptId}`)
          if (histRes.ok) {
            const hist = await histRes.json() as Record<string, {
              status?: { status_str?: string }
              outputs?: Record<string, {
                images?: { filename: string }[]
                gifs?: { filename: string }[]
                audio?: { filename: string }[]
                text?: string[]
                string?: string[]
              }>
            }>
            const entry = hist[result.promptId]
            const inferKind = (filename: string): 'image' | 'video' | 'audio' | 'model' | 'file' => {
              const ext = filename.split('.').pop()?.toLowerCase() ?? ''
              if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) return 'image'
              if (['gif', 'mp4', 'webm', 'avi', 'mov'].includes(ext)) return 'video'
              if (['wav', 'mp3', 'flac', 'ogg', 'aiff', 'm4a'].includes(ext)) return 'audio'
              if (['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'].includes(ext)) return 'model'
              return 'file'
            }
            const files: OutputItem[] = []
            for (const nodeOut of Object.values(entry?.outputs ?? {})) {
              for (const f of nodeOut.images ?? []) files.push({ filename: f.filename, kind: inferKind(f.filename) })
              for (const f of nodeOut.gifs ?? []) files.push({ filename: f.filename, kind: inferKind(f.filename) })
              for (const f of nodeOut.audio ?? []) files.push({ filename: f.filename, kind: 'audio' })
              for (const t of [...(nodeOut.text ?? []), ...(nodeOut.string ?? [])]) {
                if (typeof t === 'string' && t.trim()) {
                  const k = inferKind(t)
                  if (k !== 'file') files.push({ filename: t, kind: k })
                  else files.push({ text: t, kind: 'text' })
                }
              }
            }
            setOutputs(files)
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
            setExecMeta({ seed: result.seed, elapsed: `${elapsed}s` })

            await fetch(`/api/executions/${result.executionId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: entry?.status?.status_str === 'error' ? 'error' : 'completed',
                outputsJson: JSON.stringify(files),
                completedAt: Date.now(),
              }),
            }).catch(() => {})
          }
        } catch { /* ignore */ }

        setRunning(false)
      }

      const sse = new EventSource(`/api/comfy/${result.comfyPort}/ws`)

      sse.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as { type: string; data?: Record<string, unknown> }
          if (msg.data?.prompt_id !== result.promptId) return

          if (msg.type === 'progress') {
            const value = msg.data?.value as number
            const max = msg.data?.max as number
            if (max > 0) setProgress(Math.round((value / max) * 100))
          } else if (msg.type === 'executing' && msg.data?.node === null) {
            setProgress(100)
            sse.close()
            finish()
          } else if (msg.type === 'execution_error') {
            sse.close()
            finish(true)
          }
        } catch { /* ignore */ }
      }

      sse.onerror = () => { sse.close() }

      const pollInterval = setInterval(async () => {
        if (done) { clearInterval(pollInterval); return }
        try {
          const histRes = await fetch(`/api/comfy/${result.comfyPort}/history/${result.promptId}`)
          if (!histRes.ok) return
          const hist = await histRes.json() as Record<string, { status?: { completed?: boolean } }>
          if (hist[result.promptId]?.status?.completed) {
            clearInterval(pollInterval)
            sse.close()
            finish()
          }
        } catch { /* ignore */ }
      }, 3000)

      setTimeout(() => {
        if (!done) {
          done = true
          sse.close()
          clearInterval(pollInterval)
          setError(['Timed out waiting for ComfyUI'])
          setRunning(false)
        }
      }, 300_000)

    } catch {
      setError(['Failed to start execution'])
      setRunning(false)
    }
  }, [inputs, tool.id, tool.comfyPort])

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
            const label = field.label || (field.nodeTitle ? `${field.nodeTitle} — ${field.paramName}` : field.paramName)
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
          No ComfyUI instance was selected. Save with a ComfyUI port first.
        </div>
      )}

      {/* Run button + progress */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleRun}
          disabled={running || !tool.comfyPort}
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {running ? (
            <>
              <LottieSpinner size={14} />
              Running… {progress > 0 && `${progress}%`}
            </>
          ) : (
            <>
              <Play size={14} weight="fill" />
              Run Test
            </>
          )}
        </button>
      </div>

      {error.length > 0 && (
        <div className="flex flex-col gap-1 bg-red-950/20 border border-red-900/30 rounded-xl px-4 py-3">
          {error.map((line, i) => (
            <div key={i} className="flex items-start gap-2 text-red-400 text-sm font-mono">
              {i === 0 && <Warning size={14} weight="fill" className="shrink-0 mt-0.5" />}
              {i > 0 && <span className="w-[14px] shrink-0" />}
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}

      {/* ComfyUI logs */}
      {tool.comfyPort && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setLogsOpen((v) => !v)}
            className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors w-fit"
          >
            <span className={`transition-transform ${logsOpen ? 'rotate-90' : ''}`}>▶</span>
            ComfyUI Logs
          </button>
          {logsOpen && (
            <div className="h-48">
              <ComfyLogsPanel port={tool.comfyPort} />
            </div>
          )}
        </div>
      )}

      {/* Output preview */}
      {(running || outputs.length > 0) && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Output Preview</h3>
          {running ? (
            <div className="grid grid-cols-2 gap-3">
              {(expectedOutputKinds.length > 0 ? expectedOutputKinds : ['image' as const]).map((kind, i) => (
                <OutputLoadingPlaceholder key={i} kind={kind} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {outputs.map((out, i) => {
                if (out.kind === 'text') {
                  return (
                    <div key={i} className="col-span-2 bg-zinc-900 border border-white/5 rounded-xl px-4 py-3">
                      <p className="text-sm text-zinc-300 whitespace-pre-wrap font-mono-custom">{out.text}</p>
                    </div>
                  )
                }
                const url = `/api/comfy/${tool.comfyPort}/view?filename=${encodeURIComponent(out.filename)}&type=output`
                if (out.kind === 'image') return <BlurRevealImage key={out.filename} src={url} alt={out.filename} />
                if (out.kind === 'video') {
                  return (
                    <video key={out.filename} src={url} controls loop className="w-full rounded-xl border border-zinc-800 bg-black" />
                  )
                }
                if (out.kind === 'audio') {
                  return (
                    <div key={out.filename} className="col-span-2 flex flex-col gap-1">
                      <span className="text-xs text-zinc-500 truncate">{out.filename}</span>
                      <audio controls src={url} className="w-full" />
                    </div>
                  )
                }
                if (out.kind === 'model') return <ModelPreview key={out.filename} src={url} filename={out.filename} />
                return (
                  <a
                    key={out.filename}
                    href={url}
                    download={out.filename}
                    className="col-span-2 flex items-center gap-2 px-4 py-3 rounded-xl border border-white/5 bg-zinc-900 hover:bg-zinc-800 transition-colors text-sm text-zinc-300"
                  >
                    <Spinner size={14} className="text-zinc-500" />
                    {out.filename}
                    <span className="ml-auto text-xs text-zinc-600">Download</span>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      )}

      {execMeta && (
        <div className="flex gap-4 text-xs text-zinc-500 font-mono-custom">
          <span>seed: {execMeta.seed}</span>
          <span>elapsed: {execMeta.elapsed}</span>
        </div>
      )}
    </div>
  )
}
