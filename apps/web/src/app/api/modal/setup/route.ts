import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { installModal, startModalAuth, disconnectModal } from '@/lib/modal-manager'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  if (action === 'install') {
    const result = await installModal()
    return NextResponse.json(result)
  }

  if (action === 'authenticate') {
    const result = startModalAuth()
    return NextResponse.json(result)
  }

  if (action === 'disconnect') {
    const result = disconnectModal()
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
