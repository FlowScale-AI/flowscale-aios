import { NextRequest, NextResponse } from 'next/server'
import {
  listModalEndpointConfigs,
  setModalEndpointConfig,
  removeModalEndpointConfig,
} from '@/lib/modalInference'

/** GET /api/settings/modal-endpoints — list all registered Modal endpoints */
export async function GET() {
  return NextResponse.json(listModalEndpointConfigs())
}

/** POST /api/settings/modal-endpoints — upsert an endpoint config
 *  body: { modelId: string, url: string, key?: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as { modelId?: string; url?: string; key?: string; appName?: string }

  if (!body.modelId || typeof body.modelId !== 'string') {
    return NextResponse.json({ error: 'modelId is required' }, { status: 400 })
  }
  if (!body.url || typeof body.url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  setModalEndpointConfig(body.modelId, {
    url: body.url,
    ...(body.key ? { key: body.key } : {}),
    ...(body.appName ? { appName: body.appName } : {}),
  })

  return NextResponse.json({ ok: true })
}

/** DELETE /api/settings/modal-endpoints?modelId=... — remove an endpoint */
export async function DELETE(req: NextRequest) {
  const modelId = req.nextUrl.searchParams.get('modelId')
  if (!modelId) {
    return NextResponse.json({ error: 'modelId query param is required' }, { status: 400 })
  }
  removeModalEndpointConfig(modelId)
  return NextResponse.json({ ok: true })
}
