import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getCustomScripts, setCustomScripts, type CustomScript } from '@/lib/providerSettings'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ scripts: getCustomScripts() })
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { scripts?: unknown } | null
  if (!body || !Array.isArray(body.scripts)) {
    return NextResponse.json({ error: 'scripts array required' }, { status: 400 })
  }

  const validated: CustomScript[] = []
  const seenIds = new Set<string>()
  for (const s of body.scripts) {
    if (
      typeof s !== 'object' || s === null ||
      typeof (s as Record<string, unknown>).id !== 'string' ||
      typeof (s as Record<string, unknown>).label !== 'string' ||
      typeof (s as Record<string, unknown>).path !== 'string'
    ) {
      return NextResponse.json({ error: 'each script must have id, label, and path strings' }, { status: 400 })
    }
    const id = (s as Record<string, string>).id.trim()
    const label = (s as Record<string, string>).label.trim()
    const scriptPath = (s as Record<string, string>).path.trim()
    if (!id) return NextResponse.json({ error: 'id must not be empty' }, { status: 400 })
    if (label.length > 128) return NextResponse.json({ error: `label too long (max 128 chars)` }, { status: 400 })
    if (scriptPath.length > 4096) return NextResponse.json({ error: `path too long (max 4096 chars)` }, { status: 400 })
    if (seenIds.has(id)) {
      return NextResponse.json({ error: `duplicate script id: ${id}` }, { status: 400 })
    }
    seenIds.add(id)
    validated.push({ id, label, path: scriptPath })
  }

  setCustomScripts(validated)
  return NextResponse.json({ scripts: getCustomScripts() })
}
