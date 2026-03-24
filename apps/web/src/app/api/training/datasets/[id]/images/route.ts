import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import { getDatasetDir } from '@/lib/training'
import { join } from 'path'
import { existsSync } from 'fs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dir = getDatasetDir(id)
  if (!existsSync(dir)) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }
  const formData = await req.formData()
  const files = formData.getAll('images') as File[]
  if (!files.length) {
    return NextResponse.json({ error: 'No images provided' }, { status: 400 })
  }
  const VALID_TYPES = new Set(['image/jpeg', 'image/png'])
  const saved: string[] = []
  for (const file of files) {
    if (!VALID_TYPES.has(file.type)) continue
    const buffer = Buffer.from(await file.arrayBuffer())
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    await writeFile(join(dir, safeName), buffer)
    saved.push(safeName)
  }
  return NextResponse.json({ uploaded: saved })
}
