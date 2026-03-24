import { NextRequest, NextResponse } from 'next/server'
import { createDataset, listDatasets } from '@/lib/training'

export async function GET() {
  return NextResponse.json(listDatasets())
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, triggerWord } = body as { name?: string; triggerWord?: string }
  if (!name || !triggerWord) {
    return NextResponse.json({ error: 'name and triggerWord are required' }, { status: 400 })
  }
  const dataset = createDataset({ name, triggerWord })
  return NextResponse.json(dataset, { status: 201 })
}
