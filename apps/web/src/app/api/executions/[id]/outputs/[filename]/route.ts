import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const API_OUTPUTS_DIR = join(homedir(), '.flowscale', 'aios-outputs')

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params

  if (filename.includes('/') || filename.includes('..') || id.includes('/') || id.includes('..')) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const filePath = join(API_OUTPUTS_DIR, id, filename)
  try {
    const data = readFileSync(filePath)
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'png'
    const contentType =
      ext === 'png' ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : 'application/octet-stream'
    return new NextResponse(data, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
    })
  } catch {
    return new NextResponse('Not Found', { status: 404 })
  }
}
