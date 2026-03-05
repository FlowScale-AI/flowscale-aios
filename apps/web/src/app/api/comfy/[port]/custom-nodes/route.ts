import { NextRequest, NextResponse } from 'next/server'

type Params = { params: Promise<{ port: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { port } = await params

  let files: string[]
  try {
    const res = await fetch(`http://127.0.0.1:${port}/models/custom_nodes`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return NextResponse.json({ error: 'Cannot reach ComfyUI' }, { status: 503 })
    files = await res.json()
  } catch {
    return NextResponse.json({ error: 'Cannot reach ComfyUI' }, { status: 503 })
  }

  // Each entry is a relative path like "ComfyUI-fal-API/fal_node.py" or "websocket_image_save.py".
  // Extract unique top-level names.
  const seen = new Set<string>()
  const nodes: { name: string; type: 'file' | 'folder' }[] = []

  for (const f of files) {
    const slash = f.indexOf('/')
    if (slash === -1) {
      // top-level file (e.g. "websocket_image_save.py")
      if (f.startsWith('.') || f === '__pycache__') continue
      if (!f.endsWith('.py') || f === '__init__.py') continue
      const name = f.slice(0, -3)
      if (!seen.has(name)) {
        seen.add(name)
        nodes.push({ name, type: 'file' })
      }
    } else {
      // file inside a package directory
      const dir = f.slice(0, slash)
      if (!seen.has(dir) && !dir.startsWith('.') && dir !== '__pycache__') {
        seen.add(dir)
        nodes.push({ name: dir, type: 'folder' })
      }
    }
  }

  return NextResponse.json({ nodes })
}
