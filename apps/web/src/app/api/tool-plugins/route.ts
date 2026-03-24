import { NextResponse } from 'next/server'
import { fetchRegistry, scanPlugins } from '@/lib/toolPlugins'

export async function GET() {
  const [registry, plugins] = await Promise.all([
    fetchRegistry(),
    Promise.resolve(scanPlugins()),
  ])

  const installedPluginIds = plugins.map((p) => p.id)

  // Build a map of installed plugin versions for update detection
  const installedVersions: Record<string, string> = {}
  for (const p of plugins) {
    installedVersions[p.id] = p.version
  }

  return NextResponse.json({ registry, installedPluginIds, installedVersions })
}
