'use client'

import { useRef, useState, useEffect } from 'react'
import { UploadSimple, X, Spinner } from 'phosphor-react'

let _mvLoaded = false
let _mvLoading = false
function loadModelViewer(): Promise<void> {
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

function InputPreview({ kind, src, filename }: { kind: 'image' | 'audio' | 'video' | 'model'; src: string; filename: string }) {
  const [mvReady, setMvReady] = useState(false)
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const modelViewable = ['glb', 'gltf'].includes(ext)

  useEffect(() => {
    if (kind === 'model' && modelViewable) loadModelViewer().then(() => setMvReady(true))
  }, [kind, modelViewable])

  if (kind === 'image') {
    return <img src={src} alt={filename} className="w-full h-full object-contain" />
  }
  if (kind === 'video') {
    return <video src={src} controls className="w-full h-full object-contain" />
  }
  if (kind === 'audio') {
    return (
      <div className="flex items-center justify-center h-full px-3">
        <audio controls src={src} className="w-full" />
      </div>
    )
  }
  // model
  if (modelViewable && mvReady) {
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

const ACCEPT_MAP: Record<'image' | 'audio' | 'video' | 'model', string> = {
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
  model: '.glb,.gltf,.obj,.fbx,.stl,.ply',
}

export function inferInputUploadKind(nodeType: string): 'image' | 'audio' | 'video' | 'model' | null {
  if (nodeType === 'FSLoadImage' || nodeType === 'LoadImage') return 'image'
  if (nodeType === 'FSLoadAudio' || nodeType === 'LoadAudio') return 'audio'
  if (nodeType === 'FSLoadVideo' || nodeType === 'LoadVideo') return 'video'
  if (nodeType === 'FSLoad3D') return 'model'
  return null
}

export function FileUploadInput({
  kind,
  value,
  comfyPort,
  onChange,
}: {
  kind: 'image' | 'audio' | 'video' | 'model'
  value: string
  comfyPort: number | null
  onChange: (filename: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (!comfyPort) {
      setUploadError('No ComfyUI connected')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('image', file, file.name)
      const res = await fetch(`/api/comfy/${comfyPort}/upload/image`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Upload failed (${res.status})`)
      const data = await res.json()
      onChange(data.name)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const disabled = !comfyPort

  return (
    <div className="flex flex-col gap-1">
      <div
        className={`flex items-center gap-3 bg-zinc-950 border rounded-lg px-3 py-2 transition-colors ${
          disabled
            ? 'border-white/5 opacity-50 cursor-not-allowed'
            : 'border-white/5 cursor-pointer hover:border-emerald-500/30'
        }`}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        {uploading ? (
          <Spinner size={14} className="animate-spin text-zinc-500 shrink-0" />
        ) : (
          <UploadSimple size={14} className="text-zinc-500 shrink-0" />
        )}
        <span className={`text-sm flex-1 truncate ${value ? 'text-zinc-200' : 'text-zinc-500'}`}>
          {disabled ? 'No ComfyUI connected' : value || 'Choose file…'}
        </span>
        {value && !disabled && (
          <button
            onClick={(e) => { e.stopPropagation(); onChange(''); setUploadError(null) }}
            className="text-zinc-600 hover:text-zinc-400 shrink-0"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_MAP[kind]}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
      {uploadError && <span className="text-xs text-red-400">{uploadError}</span>}
      {value && comfyPort && (
        <div className={`rounded-lg overflow-hidden border border-white/5 bg-zinc-950 ${kind === 'audio' ? 'h-16' : 'h-40'}`}>
          <InputPreview
            kind={kind}
            src={`/api/comfy/${comfyPort}/view?filename=${encodeURIComponent(value)}&type=input`}
            filename={value}
          />
        </div>
      )}
    </div>
  )
}
