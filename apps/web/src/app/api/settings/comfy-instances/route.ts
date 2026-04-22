import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import {
  getComfyInstances,
  setComfyInstances,
  getCustomScripts,
  type ComfyInstanceConfig,
} from '@/lib/providerSettings'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { instances?: unknown } | null
  if (!body || !Array.isArray(body.instances)) {
    return NextResponse.json({ error: 'instances array required' }, { status: 400 })
  }

  // Merge incoming launchScriptId values into existing configs — don't allow
  // callers to overwrite port/device/label (those come from detect flow).
  const existing = getComfyInstances()
  const updates = body.instances as Array<{ id: string; launchScriptId?: string | null }>

  const scripts = getCustomScripts()
  const merged: ComfyInstanceConfig[] = []
  for (const inst of existing) {
    const update = updates.find((u) => u.id === inst.id)
    if (!update) { merged.push(inst); continue }
    const next = { ...inst }
    if (update.launchScriptId === null || update.launchScriptId === '') {
      delete next.launchScriptId
    } else if (typeof update.launchScriptId === 'string') {
      if (!scripts.some((s) => s.id === update.launchScriptId)) {
        return NextResponse.json(
          { error: `Custom script '${update.launchScriptId}' not found in registry` },
          { status: 400 },
        )
      }
      next.launchScriptId = update.launchScriptId
    }
    merged.push(next)
  }

  setComfyInstances(merged)
  return NextResponse.json({ instances: getComfyInstances() })
}
