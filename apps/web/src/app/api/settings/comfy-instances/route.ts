import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import {
  getComfyInstances,
  setComfyInstances,
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

  const merged: ComfyInstanceConfig[] = existing.map((inst) => {
    const update = updates.find((u) => u.id === inst.id)
    if (!update) return inst
    const next = { ...inst }
    if (update.launchScriptId === null || update.launchScriptId === '') {
      delete next.launchScriptId
    } else if (typeof update.launchScriptId === 'string') {
      next.launchScriptId = update.launchScriptId
    }
    return next
  })

  setComfyInstances(merged)
  return NextResponse.json({ instances: getComfyInstances() })
}
