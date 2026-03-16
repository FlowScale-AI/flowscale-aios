import { NextResponse } from 'next/server'
import { fetchRegistry, scanPlugins } from '@/lib/toolPlugins'

export async function GET() {
  const [registry, plugins] = await Promise.all([
    fetchRegistry(),
    Promise.resolve(scanPlugins()),
  ])

  const installedPluginIds = plugins.map((p) => p.id)

  return NextResponse.json({ registry, installedPluginIds })
}
