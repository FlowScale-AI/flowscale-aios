import { NextRequest, NextResponse } from 'next/server'
import { installModal, startModalAuth, disconnectModal, getModalStatus, isAuthInProgress } from '@/lib/modal-manager'

/**
 * GET /api/setup/modal
 * Returns Modal CLI status. No auth required — used during first-run setup.
 */
export async function GET() {
  const status = getModalStatus()
  return NextResponse.json({ ...status, authInProgress: isAuthInProgress() })
}

/**
 * POST /api/setup/modal
 * Performs Modal setup actions (install, authenticate, disconnect).
 * No auth required — used during first-run setup.
 */
export async function POST(req: NextRequest) {
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
