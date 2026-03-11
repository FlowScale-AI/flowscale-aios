import { NextRequest, NextResponse } from 'next/server'
import {
  ALL_PROVIDER_NAMES,
  PROVIDERS,
  getProviderKey,
  type ProviderName,
} from '@/lib/providerSettings'
import { getRequestUser } from '@/lib/auth'

type Params = { params: Promise<{ name: string; path: string[] }> }

async function proxyRequest(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, path } = await params

  if (!ALL_PROVIDER_NAMES.includes(name as ProviderName)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 })
  }

  const apiKey = getProviderKey(name as ProviderName)
  if (!apiKey) {
    return NextResponse.json({ error: `${name} API key not configured` }, { status: 403 })
  }

  const provider = PROVIDERS[name as ProviderName]
  const subpath = path.join('/')
  const search = req.nextUrl.search
  const upstreamUrl = `${provider.baseUrl}/${subpath}${search}`

  // Forward headers — strip host/next-specific headers
  const forwardHeaders: Record<string, string> = {
    'Authorization': buildAuthHeader(name as ProviderName, apiKey),
    'Content-Type': req.headers.get('content-type') ?? 'application/json',
  }

  const upstreamRes = await fetch(upstreamUrl, {
    method: req.method,
    headers: forwardHeaders,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
  })

  const body = await upstreamRes.arrayBuffer()
  return new NextResponse(body, {
    status: upstreamRes.status,
    headers: {
      'Content-Type': upstreamRes.headers.get('content-type') ?? 'application/json',
    },
  })
}

function buildAuthHeader(provider: ProviderName, key: string): string {
  switch (provider) {
    case 'fal':
      return `Key ${key}`
    case 'replicate':
    case 'openrouter':
    case 'huggingface':
      return `Bearer ${key}`
  }
}

export { proxyRequest as GET, proxyRequest as POST, proxyRequest as PATCH, proxyRequest as PUT, proxyRequest as DELETE }
