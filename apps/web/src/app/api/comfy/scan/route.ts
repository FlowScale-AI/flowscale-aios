import { NextResponse } from 'next/server'
import { getComfyInstances } from '@/lib/providerSettings'
import { probePort } from '@/lib/comfy-probe'

export type { ComfyInstance } from '@/lib/comfy-probe'

export async function GET() {
  const instances = getComfyInstances()

  // Probe all configured instance ports in parallel
  const results = await Promise.all(
    instances.map(async (cfg) => {
      const probe = await probePort(cfg.port)
      if (!probe) return null
      return { ...probe, instanceId: cfg.id, device: cfg.device, label: cfg.label }
    }),
  )

  const alive = results.filter(Boolean)

  // Fire-and-forget model scan for each discovered instance
  for (const inst of alive) {
    if (!inst) continue
    fetch('http://localhost:14173/api/models/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comfyPort: inst.port }),
    }).catch(() => { /* background — ignore errors */ })
  }

  return NextResponse.json(alive)
}
