import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join, normalize, resolve } from 'path'
import { homedir } from 'os'

const BASE_DIR = resolve(join(homedir(), '.flowscale', 'aios-outputs'))

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params

  // Prevent path traversal
  const filePath = resolve(join(BASE_DIR, ...path))
  if (!filePath.startsWith(BASE_DIR)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const buffer = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const contentType =
      ext === 'png' ? 'image/png' :
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif' ? 'image/gif' :
      ext === 'mp4' ? 'video/mp4' :
      ext === 'webm' ? 'video/webm' :
      ext === 'mov' ? 'video/quicktime' :
      ext === 'mp3' ? 'audio/mpeg' :
      ext === 'wav' ? 'audio/wav' :
      ext === 'flac' ? 'audio/flac' :
      ext === 'ogg' ? 'audio/ogg' :
      ext === 'opus' ? 'audio/ogg; codecs=opus' :
      ext === 'm4a' ? 'audio/mp4' :
      ext === 'glb' ? 'model/gltf-binary' :
      ext === 'gltf' ? 'model/gltf+json' :
      ext === 'obj' ? 'model/obj' :
      'application/octet-stream'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
