import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequestUser } from '@/lib/auth'
import { updatePluginFromSource, updateRegistryPlugin } from '@/lib/toolPlugins'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { toolId, pluginId } = body as { toolId?: string; pluginId?: string }

  if (!toolId && !pluginId) {
    return NextResponse.json({ error: 'Missing toolId or pluginId' }, { status: 400 })
  }

  try {
    const db = getDb()

    if (pluginId) {
      // Registry plugin update — re-download from S3
      const tool = await updateRegistryPlugin(pluginId, db)
      return NextResponse.json(tool)
    }

    // Custom plugin update — re-import from sourceUrl
    const tool = await updatePluginFromSource(toolId!, db)
    return NextResponse.json(tool)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
