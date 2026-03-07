import { NextResponse } from 'next/server'
import { getServerLogs } from '@/lib/localInference'

export async function GET() {
  return NextResponse.json({ logs: getServerLogs() })
}
