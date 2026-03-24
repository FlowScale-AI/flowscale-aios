'use client'

import { useRef, useState, useCallback } from 'react'
import { CloudArrowUp, FolderOpen, Spinner, CheckCircle, WarningCircle } from 'phosphor-react'

interface DatasetUploaderProps {
  datasetId: string
  onUploadComplete?: (uploadedNames: string[]) => void
}

export function DatasetUploader({ datasetId, onUploadComplete }: DatasetUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lastResult, setLastResult] = useState<{ uploaded: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type === 'image/jpeg' || f.type === 'image/png')
      if (!images.length) {
        setError('Only JPEG and PNG images are accepted.')
        return
      }
      setUploading(true)
      setError(null)
      setLastResult(null)
      try {
        const form = new FormData()
        for (const img of images) {
          form.append('images', img, img.name)
        }
        const res = await fetch(`/api/training/datasets/${datasetId}/images`, {
          method: 'POST',
          body: form,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`)
        }
        const data = (await res.json()) as { uploaded: string[] }
        setLastResult(data)
        onUploadComplete?.(data.uploaded)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [datasetId, onUploadComplete],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const files = Array.from(e.dataTransfer.files)
      uploadFiles(files)
    },
    [uploadFiles],
  )

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handlePickFiles = async () => {
    if (typeof window !== 'undefined' && window.desktop) {
      // Electron: use native file dialog
      try {
        const result = await window.desktop.dialog.openFile()
        if (!result) return
        const paths: string[] = JSON.parse(result)
        if (!paths?.length) return
        // In Electron we fetch the files by path via the browser File API
        // Fall back to the hidden input for the actual upload
        inputRef.current?.click()
      } catch {
        inputRef.current?.click()
      }
    } else {
      inputRef.current?.click()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) uploadFiles(files)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-colors cursor-pointer select-none',
          isDragging
            ? 'border-emerald-500/60 bg-emerald-500/5'
            : 'border-white/10 bg-zinc-900/50 hover:border-emerald-500/30 hover:bg-zinc-900',
        ].join(' ')}
        onClick={handlePickFiles}
      >
        {uploading ? (
          <Spinner size={32} className="animate-spin text-emerald-400" />
        ) : (
          <CloudArrowUp
            size={32}
            weight="duotone"
            className={isDragging ? 'text-emerald-400' : 'text-zinc-500'}
          />
        )}
        <div className="text-center">
          <p className={`text-sm font-medium ${isDragging ? 'text-emerald-300' : 'text-zinc-300'}`}>
            {uploading
              ? 'Uploading…'
              : isDragging
                ? 'Drop images here'
                : 'Drag & drop images here'}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            JPEG and PNG — or{' '}
            <span className="text-emerald-400 underline underline-offset-2">browse files</span>
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handlePickFiles()
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
        >
          <FolderOpen size={13} />
          Browse
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          <WarningCircle size={13} weight="fill" />
          {error}
        </div>
      )}

      {lastResult && !error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
          <CheckCircle size={13} weight="fill" />
          {lastResult.uploaded.length} image{lastResult.uploaded.length !== 1 ? 's' : ''} uploaded
          successfully
        </div>
      )}
    </div>
  )
}
