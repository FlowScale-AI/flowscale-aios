import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getComfyInstances, setComfyInstances } from '@/lib/providerSettings'
import { getInstanceStatus, stopInstance } from '@/lib/comfyui-manager'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = getComfyInstances()
  if (!existing.some((i) => i.id === id)) {
    return NextResponse.json({ error: `Instance '${id}' not found` }, { status: 404 })
  }

  // Stop the instance if it's still alive — stopInstance handles PID file cleanup
  const status = getInstanceStatus(id)
  if (status.alive) {
    stopInstance(id)
  }

  setComfyInstances(existing.filter((i) => i.id !== id))

  return NextResponse.json({ ok: true })
}
