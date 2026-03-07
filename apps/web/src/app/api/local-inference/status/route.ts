import { NextResponse } from 'next/server'
import { isServerRunning } from '@/lib/localInference'

export async function GET() {
  const running = await isServerRunning()
  return NextResponse.json({ running })
}
