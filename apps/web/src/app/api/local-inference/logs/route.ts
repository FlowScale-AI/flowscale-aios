import { NextRequest, NextResponse } from 'next/server'
import { getServerLogs } from '@/lib/localInference'

export async function GET(req: NextRequest) {
  const pluginId = req.nextUrl.searchParams.get('pluginId') ?? undefined
  return NextResponse.json({ logs: getServerLogs(pluginId) })
}
