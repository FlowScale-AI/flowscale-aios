import { NextRequest, NextResponse } from 'next/server'
import { getDataset, updateDatasetMeta, updateCaption, deleteDataset } from '@/lib/training'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dataset = getDataset(id)
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  return NextResponse.json(dataset)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { name, triggerWord, captions } = body as {
    name?: string
    triggerWord?: string
    captions?: Array<{ imageName: string; caption: string }>
  }
  if (name !== undefined || triggerWord !== undefined) {
    updateDatasetMeta(id, { name, triggerWord })
  }
  if (captions) {
    for (const { imageName, caption } of captions) {
      updateCaption(id, imageName, caption)
    }
  }
  const updated = getDataset(id)
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  deleteDataset(id)
  return NextResponse.json({ ok: true })
}
