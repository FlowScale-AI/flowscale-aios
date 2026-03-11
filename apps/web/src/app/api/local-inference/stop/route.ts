import { NextResponse } from 'next/server'
import { stopServer } from '@/lib/localInference'

export async function POST() {
  const stopped = stopServer()
  return NextResponse.json({ stopped })
}
