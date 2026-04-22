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
  for (const s of body.scripts) {
    if (
      typeof s !== 'object' || s === null ||
      typeof (s as Record<string, unknown>).id !== 'string' ||
      typeof (s as Record<string, unknown>).label !== 'string' ||
      typeof (s as Record<string, unknown>).path !== 'string'
    ) {
      return NextResponse.json({ error: 'each script must have id, label, and path strings' }, { status: 400 })
    }
    validated.push({
      id: (s as Record<string, string>).id.trim(),
      label: (s as Record<string, string>).label.trim(),
      path: (s as Record<string, string>).path.trim(),
    })
  }

  setCustomScripts(validated)
  return NextResponse.json({ scripts: getCustomScripts() })
}
