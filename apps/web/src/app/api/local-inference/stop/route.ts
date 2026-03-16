import { NextRequest, NextResponse } from 'next/server'
import { stopServer } from '@/lib/localInference'

export async function POST(req: NextRequest) {
  const pluginId = req.nextUrl.searchParams.get('pluginId') ?? undefined
  const stopped = stopServer(pluginId)
  return NextResponse.json({ stopped })
}
