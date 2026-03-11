import { useState, useRef, DragEvent, ChangeEvent } from 'react'
import { apiClient } from '../api/client'

interface Props {
  comfyPort: number | undefined
  value: string
  onChange: (filename: string) => void
}

export function ImageUpload({ comfyPort, value, onChange }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)

    // Always show a local preview
    const reader = new FileReader()
    reader.onload = (e) => setPreview(e.target?.result as string)
    reader.readAsDataURL(file)

    try {
      if (comfyPort) {
        const filename = await apiClient.uploadImage(comfyPort, file)
        onChange(filename)
      } else {
        // API-engine tools: pass base64 data URL directly
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = (e) => resolve(e.target!.result as string)
          r.onerror = reject
          r.readAsDataURL(file)
        })
        onChange(dataUrl)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const previewSrc = preview ?? (value && comfyPort
    ? `/api/comfy/${comfyPort}/view?filename=${encodeURIComponent(value)}&type=input`
    : null)

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[120px] ${
          dragging ? 'border-emerald-500 bg-emerald-500/5' : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900'
        }`}
      >
        {previewSrc ? (
          <img src={previewSrc} alt="preview" className="max-h-40 rounded object-contain" />
        ) : (
          <div className="text-center p-4">
            <svg className="mx-auto w-8 h-8 text-zinc-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-xs text-zinc-500">
              {uploading ? 'Uploading…' : 'Click or drag to upload'}
            </p>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 rounded-lg">
            <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onInputChange} />
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      {value && !error && (
        <p className="text-xs text-zinc-500 mt-1 truncate">
          {comfyPort ? `Uploaded: ${value}` : 'Image ready'}
        </p>
      )}
    </div>
  )
}
