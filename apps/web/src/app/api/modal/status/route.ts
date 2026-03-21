import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getModalStatus, isAuthInProgress } from '@/lib/modal-manager'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const status = getModalStatus()
  return NextResponse.json({
    ...status,
    authInProgress: isAuthInProgress(),
  })
}
