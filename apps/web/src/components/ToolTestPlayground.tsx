'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Warning, Monitor, ImageSquare } from 'phosphor-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { LottieSpinner } from '@/components/ui'
import { ComfyLogsPanel } from '@/components/ComfyLogsPanel'
import { getComfyOrgApiKey } from '@/lib/platform'
import { FileUploadInput, inferInputUploadKind } from '@/components/FileUploadInput'
import { InstanceSelector } from '@/components/InstanceSelector'

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
  if (['FSSaveVideo', 'VHS_VideoCombine', 'SaveVideo'].includes(nodeType)) return 'video'
  if (['FSSaveAudio', 'SaveAudio', 'PreviewAudio'].includes(nodeType)) return 'audio'
  if (['FSSave3D', 'FSHunyuan3DGenerate', 'Save3D', 'TripoSGSave', 'MeshSave'].includes(nodeType) || /Save.*3[Dd]|3[Dd].*Save|GLB|GLTF|Mesh/i.test(nodeType)) return 'model'
  if (['FSSaveText', 'FSSaveInteger'].includes(nodeType)) return 'text'
  return 'file'
}

// ─── Output loading placeholders ──────────────────────────────────────────────

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

let _modelViewerLoaded = false
let _modelViewerLoading = false
function loadModelViewer(): Promise<void> {
  return new Promise((resolve) => {
    if (_modelViewerLoaded) { resolve(); return }
    if (typeof window !== 'undefined' && customElements.get('model-viewer')) { _modelViewerLoaded = true; resolve(); return }
    if (_modelViewerLoading) { const t = setInterval(() => { if (_modelViewerLoaded) { clearInterval(t); resolve() } }, 100); return }
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
  const viewable = ['glb', 'gltf'].includes(ext)
  useEffect(() => { if (viewable) loadModelViewer().then(() => setReady(true)) }, [viewable])
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

  // ── ComfyUI instance selection ──────────────────────────────────────────────
  const { data: comfyManageData } = useQuery<{ instances: Array<{ id: string; status: string; port: number; device: string; label: string }> }>({
    queryKey: ['comfy-manage'],
    queryFn: async () => {
      const res = await fetch('/api/comfy/manage')
      if (!res.ok) return { instances: [] }
      return res.json()
    },
  })
  const comfyInstances = comfyManageData?.instances ?? []
  const runningInstances = comfyInstances.filter((i) => i.status === 'running')
  // 'auto' = auto-route to least busy running instance; number = pinned; null = default
  const [selectedComfyPort, setSelectedComfyPort] = useState<number | 'auto' | null>(null)
  // When auto (or default), resolve at render time; actual routing for execution happens in handleRun
  const effectiveComfyPort: number | null =
    selectedComfyPort === 'auto' || selectedComfyPort === null
      ? (tool.comfyPort ?? runningInstances[0]?.port ?? null)
      : selectedComfyPort
  const comfyInstanceLabel = effectiveComfyPort
    ? comfyInstances.find((i) => i.port === effectiveComfyPort)?.label ?? `:${effectiveComfyPort}`
    : undefined
  const isAutoRoute = selectedComfyPort === 'auto' || (selectedComfyPort === null && runningInstances.length > 1)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  type OutputFile = { filename: string; subfolder?: string; kind: 'image' | 'video' | 'audio' | 'model' | 'file' }
  type OutputText = { text: string; kind: 'text' }
  type OutputItem = OutputFile | OutputText
  const [outputs, setOutputs] = useState<OutputItem[]>([])
  const [execMeta, setExecMeta] = useState<{ seed: number; elapsed: string } | null>(null)
  const [error, setError] = useState<string[]>([])
  const [logsOpen, setLogsOpen] = useState(false)

  /** Round-robin counter — persists across renders via ref, cycles through running instances. */
  const rrIndexRef = useRef(0)

  /** Resolve the port: if auto-routing, round-robin across running instances. */
  const resolveComfyPort = useCallback((): number | null => {
    if (selectedComfyPort !== null && selectedComfyPort !== 'auto') return selectedComfyPort
    if (runningInstances.length <= 1) return effectiveComfyPort

    const idx = rrIndexRef.current % runningInstances.length
    rrIndexRef.current = idx + 1
    return runningInstances[idx].port
  }, [selectedComfyPort, runningInstances, effectiveComfyPort])

  const handleRun = useCallback(async () => {
    setRunning(true)
    setProgress(0)
    setOutputs([])
    setError([])
    setExecMeta(null)
    const startTime = Date.now()

    try {
      const routedPort = resolveComfyPort()
      const res = await fetch(`/api/tools/${tool.id}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, comfyOrgApiKey: getComfyOrgApiKey() || undefined, comfyPort: routedPort }),
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
                images?: { filename: string; subfolder?: string }[]
                gifs?: { filename: string; subfolder?: string }[]
                videos?: { filename: string; subfolder?: string }[]
                audio?: { filename: string; subfolder?: string }[]
                text?: string[]
                string?: string[]
              }>
            }>
            const entry = hist[result.promptId]
            console.debug('[flowscale] history outputs', JSON.stringify(entry?.outputs ?? {}))
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
              for (const f of nodeOut.images ?? []) files.push({ filename: f.filename, subfolder: f.subfolder, kind: inferKind(f.filename) })
              for (const f of nodeOut.gifs ?? []) files.push({ filename: f.filename, subfolder: f.subfolder, kind: inferKind(f.filename) })
              for (const f of nodeOut.videos ?? []) files.push({ filename: f.filename, subfolder: f.subfolder, kind: 'video' })
              for (const f of nodeOut.audio ?? []) files.push({ filename: f.filename, subfolder: f.subfolder, kind: 'audio' })
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
  }, [inputs, tool.id, resolveComfyPort])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex-1">
          <p className="text-xs text-zinc-500">Run the tool with test inputs before deploying.</p>
        </div>
        {!effectiveComfyPort && (
          <div className="flex items-center gap-2 text-amber-400 text-xs">
            <Monitor size={13} weight="duotone" />
            No ComfyUI connected
          </div>
        )}
        {/* Instance selector */}
        {comfyInstances.length > 0 && (
          <InstanceSelector
            instances={comfyInstances}
            value={selectedComfyPort}
            onChange={setSelectedComfyPort}
          />
        )}
        <button
          onClick={handleRun}
          disabled={running || !effectiveComfyPort}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold rounded-md transition-colors"
        >
          {running ? (
            <>
              <LottieSpinner size={14} />
              Running… {progress > 0 && `${progress}%`}
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
      {error.length > 0 && (
        <div className="px-4 py-2.5 bg-red-950/30 border-b border-red-900/50 shrink-0">
          {error.map((line, i) => (
            <div key={i} className="flex items-start gap-2 text-red-400 text-sm">
              {i === 0 && <Warning size={14} weight="fill" className="shrink-0 mt-0.5" />}
              {i > 0 && <span className="w-[14px] shrink-0" />}
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}

      {/* 2-pane content */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup orientation="horizontal">
          {/* Left: Inputs */}
          <Panel defaultSize={40} minSize={25}>
            <div className="h-full overflow-y-auto px-5 py-5">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Inputs</h2>
              {schema.length === 0 ? (
                <p className="text-sm text-zinc-600">No configurable inputs detected.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {schema.map((field) => {
                    const key = `${field.nodeId}__${field.paramName}`
                    const label = field.label || (field.nodeTitle ? `${field.nodeTitle} — ${field.paramName}` : field.paramName)
                    return (
                      <div key={key} className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-zinc-400">{label}</label>
                        {(() => {
                          const uploadKind = inferInputUploadKind(field.nodeType)
                          if (uploadKind) {
                            return (
                              <FileUploadInput
                                kind={uploadKind}
                                value={String(inputs[key] ?? '')}
                                comfyPort={effectiveComfyPort}
                                onChange={(filename) => setInputs((prev) => ({ ...prev, [key]: filename }))}
                              />
                            )
                          }
                          return (
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
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-white/5 hover:bg-emerald-500 transition-colors cursor-col-resize" />

          {/* Right: Outputs */}
          <Panel defaultSize={60} minSize={30}>
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-5 py-5">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Output</h2>

                {running && outputs.length === 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {(expectedOutputKinds.length > 0 ? expectedOutputKinds : ['image' as const]).map((kind, i) => (
                      <OutputLoadingPlaceholder key={i} kind={kind} />
                    ))}
                  </div>
                )}

                {outputs.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {outputs.map((out, i) => {
                      const cardClass = "group flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 hover:border-emerald-500/30 transition-all duration-200"
                      if (out.kind === 'text') {
                        return (
                          <div key={i} className="col-span-2 sm:col-span-3 rounded-xl border border-white/5 bg-zinc-900/50 px-4 py-3">
                            <p className="text-sm text-zinc-300 whitespace-pre-wrap font-mono-custom">{out.text}</p>
                          </div>
                        )
                      }
                      const url = `/api/comfy/${effectiveComfyPort}/view?filename=${encodeURIComponent(out.filename)}${out.subfolder ? `&subfolder=${encodeURIComponent(out.subfolder)}` : ''}&type=output`
                      if (out.kind === 'image') return (
                        <div key={i} className={cardClass}>
                          <div className="h-36 bg-zinc-950 overflow-hidden">
                            <BlurRevealImage src={url} alt={out.filename} />
                          </div>
                          <div className="px-3 py-2 border-t border-white/5">
                            <p className="text-[11px] text-zinc-500 truncate">{out.filename}</p>
                          </div>
                        </div>
                      )
                      if (out.kind === 'video') return (
                        <div key={i} className={cardClass}>
                          <video src={url} controls className="w-full aspect-video bg-zinc-950" />
                          <div className="px-3 py-2 border-t border-white/5">
                            <p className="text-[11px] text-zinc-500 truncate">{out.filename}</p>
                          </div>
                        </div>
                      )
                      if (out.kind === 'audio') return (
                        <div key={i} className={cardClass}>
                          <div className="px-4 py-4 bg-zinc-950">
                            <audio controls src={url} className="w-full" />
                          </div>
                          <div className="px-3 py-2 border-t border-white/5">
                            <p className="text-[11px] text-zinc-500 truncate">{out.filename}</p>
                          </div>
                        </div>
                      )
                      return (
                        <div key={i} className={cardClass}>
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
                )}

                {!running && outputs.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <ImageSquare size={32} weight="duotone" className="text-zinc-700 mb-3" />
                    <p className="text-sm text-zinc-600">Run the tool to see output here</p>
                  </div>
                )}
              </div>

              {/* Logs footer */}
              {effectiveComfyPort && (
                <div className="border-t border-white/5 shrink-0">
                  <button
                    onClick={() => setLogsOpen((v) => !v)}
                    className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors w-full px-5 py-2.5"
                  >
                    <span className={`transition-transform ${logsOpen ? 'rotate-90' : ''}`}>▶</span>
                    ComfyUI Logs
                    {execMeta && (
                      <span className="ml-auto text-zinc-600">seed: {execMeta.seed} · {execMeta.elapsed}</span>
                    )}
                  </button>
                  {logsOpen && (
                    <div className="h-40">
                      <ComfyLogsPanel port={effectiveComfyPort} instanceLabel={comfyInstanceLabel} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
