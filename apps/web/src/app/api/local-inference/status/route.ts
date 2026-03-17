import { NextRequest, NextResponse } from 'next/server'
import { getServerStatus } from '@/lib/localInference'

export async function GET(req: NextRequest) {
  const pluginId = req.nextUrl.searchParams.get('pluginId') ?? undefined
  const status = await getServerStatus(pluginId)
  return NextResponse.json({ status, running: status === 'running' })
}
