import { NextResponse } from 'next/server'
import { getComfyInstances } from '@/lib/providerSettings'
import { probePort, WELL_KNOWN_COMFY_PORTS } from '@/lib/comfy-probe'

export async function GET() {
  const instances = getComfyInstances()
  const configuredPorts = new Set(instances.map((i) => i.port))

  // Probe all configured instance ports in parallel
  const results = await Promise.all(
    instances.map(async (cfg) => {
      const probe = await probePort(cfg.port)
      if (!probe) return null
      return { ...probe, instanceId: cfg.id, device: cfg.device, label: cfg.label }
    }),
  )

  // Also probe well-known ports that aren't already configured
  const extraPorts = WELL_KNOWN_COMFY_PORTS.filter((p) => !configuredPorts.has(p))
  const extraResults = await Promise.all(
    extraPorts.map(async (port) => {
      const probe = await probePort(port)
      if (!probe) return null
      return { ...probe, instanceId: `external-${port}`, device: 'auto', label: `ComfyUI :${port}` }
    }),
  )

  const alive = [...results, ...extraResults].filter(Boolean)

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
