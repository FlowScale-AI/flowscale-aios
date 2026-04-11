import { NextResponse } from 'next/server'
import { networkInterfaces } from 'os'
import { getLanShareEnabled } from '@/lib/providerSettings'

export async function GET() {
  // LAN sharing is opt-in. When disabled, the packaged Next.js server binds
  // to 127.0.0.1 only, so a LAN IP would produce a dead link — return null
  // and let the caller fall back to window.location.origin.
  if (!getLanShareEnabled()) {
    return NextResponse.json({ ip: null })
  }

  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return NextResponse.json({ ip: net.address })
      }
    }
  }
  return NextResponse.json({ ip: null })
}
