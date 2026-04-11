import { NextResponse } from 'next/server'
import { getLanShareEnabled, setLanShareEnabled } from '@/lib/providerSettings'

export async function GET() {
  return NextResponse.json({ lanShare: getLanShareEnabled() })
}

export async function POST(req: Request) {
  const body = await req.json() as { lanShare?: boolean }
  if (typeof body.lanShare !== 'boolean') {
    return NextResponse.json({ error: 'lanShare must be a boolean' }, { status: 400 })
  }
  setLanShareEnabled(body.lanShare)
  return NextResponse.json({ success: true, lanShare: body.lanShare })
}
