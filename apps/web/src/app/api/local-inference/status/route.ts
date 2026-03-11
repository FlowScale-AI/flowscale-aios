import { NextResponse } from 'next/server'
import { getServerStatus } from '@/lib/localInference'

export async function GET() {
  const status = await getServerStatus()
  return NextResponse.json({ status, running: status === 'running' })
}
