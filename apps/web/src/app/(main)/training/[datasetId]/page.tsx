'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Image } from 'phosphor-react'
import { PageTransition } from '@/components/ui'
import { DatasetUploader } from '@/components/training/DatasetUploader'
import { CaptionProgress } from '@/components/training/CaptionProgress'
import { CaptionEditor } from '@/components/training/CaptionEditor'

interface DatasetImage {
  name: string
  caption: string | null
}

interface DatasetDetail {
  id: string
  name: string
  triggerWord: string
  createdAt: number
  images: DatasetImage[]
}

export default function DatasetDetailPage() {
  const { datasetId } = useParams<{ datasetId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: dataset, isLoading, isError } = useQuery<DatasetDetail>({
    queryKey: ['training-dataset', datasetId],
    queryFn: async () => {
      const res = await fetch(`/api/training/datasets/${datasetId}`)
      if (!res.ok) throw new Error('Dataset not found')
      return res.json() as Promise<DatasetDetail>
    },
  })

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['training-dataset', datasetId] })
  }, [queryClient, datasetId])

  if (isLoading) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
          Loading dataset…
        </div>
      </PageTransition>
    )
  }

  if (isError || !dataset) {
    return (
      <PageTransition>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-zinc-400 text-sm">Dataset not found.</p>
          <button
            onClick={() => router.push('/training')}
            className="text-xs text-emerald-400 hover:underline"
          >
            Back to Training
          </button>
        </div>
      </PageTransition>
    )
  }

  const hasImages = dataset.images.length > 0

  return (
    <PageTransition>
      <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.push('/training')}
            className="mt-0.5 p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            aria-label="Back to training"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-tech text-zinc-100 leading-tight truncate">
              {dataset.name}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-zinc-500">Trigger word:</span>
              <span className="text-xs font-mono text-violet-400 bg-violet-400/10 border border-violet-400/20 px-2 py-0.5 rounded">
                {dataset.triggerWord}
              </span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1.5 text-xs text-zinc-500 font-mono">
            <Image size={14} />
            {dataset.images.length} image{dataset.images.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Upload section */}
        <section>
          <h2 className="text-sm font-tech text-zinc-300 mb-3">Add Images</h2>
          <DatasetUploader
            datasetId={dataset.id}
            onUploadComplete={() => refresh()}
          />
        </section>

        {/* Caption section — only when images exist */}
        {hasImages && (
          <>
            <CaptionProgress
              datasetId={dataset.id}
              totalImages={dataset.images.length}
              onComplete={refresh}
            />

            <section>
              <h2 className="text-sm font-tech text-zinc-300 mb-3">Edit Captions</h2>
              <CaptionEditor
                datasetId={dataset.id}
                images={dataset.images}
                onUpdate={refresh}
              />
            </section>
          </>
        )}

        {/* Empty state */}
        {!hasImages && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Image size={36} weight="duotone" className="text-zinc-600 mb-3" />
            <p className="text-zinc-400 text-sm">No images yet.</p>
            <p className="text-zinc-600 text-xs mt-1">Upload images above to get started.</p>
          </div>
        )}
      </div>
    </PageTransition>
  )
}
