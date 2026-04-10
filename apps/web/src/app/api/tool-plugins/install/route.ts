import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequestUser } from '@/lib/auth'
import { fetchRegistry, downloadAndExtractPlugin, registerPluginInDb } from '@/lib/toolPlugins'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing plugin id' }, { status: 400 })

  // Look up in the official registry
  const registry = await fetchRegistry()
  const entry = registry.find((e) => e.id === id)
  if (!entry) return NextResponse.json({ error: 'Plugin not found in registry' }, { status: 404 })

  // Download and extract the plugin zip from S3
  const plugin = await downloadAndExtractPlugin(entry)

  // Register in the tools DB
  const db = getDb()
  const tool = await registerPluginInDb(db, plugin, 'registry')

  return NextResponse.json(tool, { status: 201 })
}
