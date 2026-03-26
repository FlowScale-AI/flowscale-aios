import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getAllDeployments } from '@/lib/modal-deploy'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const deployments = getAllDeployments()
  return NextResponse.json({ deployments })
}
