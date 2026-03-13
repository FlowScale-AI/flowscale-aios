import { NextResponse } from 'next/server'
import { getComfyManagedPort } from '@/lib/providerSettings'
import { probePort } from '@/lib/comfy-probe'

export type { ComfyInstance } from '@/lib/comfy-probe'

export async function GET() {
  // Only probe the AIOS-managed port — externally started instances are ignored.
  const managedPort = getComfyManagedPort()
  const instance = await probePort(managedPort)

  if (!instance) return NextResponse.json([])

  // Fire-and-forget model scan for the discovered instance
  fetch('http://localhost:14173/api/models/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comfyPort: instance.port }),
  }).catch(() => { /* background — ignore errors */ })

  return NextResponse.json([instance])
}
