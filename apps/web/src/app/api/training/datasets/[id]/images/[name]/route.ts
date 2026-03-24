import { NextRequest } from 'next/server'
import { getDatasetDir } from '@/lib/training'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params
  const dir = getDatasetDir(id)
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filePath = join(dir, safeName)
  if (!filePath.startsWith(dir) || !existsSync(filePath)) {
    return new Response('Not found', { status: 404 })
  }
  const buffer = readFileSync(filePath)
  const ext = safeName.split('.').pop()?.toLowerCase()
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
  return new Response(buffer, {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
  })
}
