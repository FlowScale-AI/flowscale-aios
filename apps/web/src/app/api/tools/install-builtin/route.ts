import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequestUser } from '@/lib/auth'
import { getPlugin, registerPluginInDb } from '@/lib/toolPlugins'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()

  const pluginId = id.endsWith('-builtin') ? id.replace(/-builtin$/, '') : id
  const plugin = getPlugin(pluginId)
  if (!plugin) return NextResponse.json({ error: 'Unknown tool plugin' }, { status: 404 })

  const db = getDb()
  const tool = await registerPluginInDb(db, plugin, 'registry')

  return NextResponse.json(tool, { status: 201 })
}
