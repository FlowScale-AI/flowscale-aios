import { NextRequest, NextResponse } from 'next/server'

type Params = { port: string; path: string[] }

function buildUpstreamUrl(port: string, path: string[], search: string): string {
  const pathStr = path.join('/')
  return `http://127.0.0.1:${port}/${pathStr}${search ? `?${search}` : ''}`
}

async function proxyRequest(req: NextRequest, port: string, path: string[]): Promise<NextResponse> {
  const url = new URL(req.url)
  const upstream = buildUpstreamUrl(port, path, url.searchParams.toString())

  const headers = new Headers(req.headers)
  headers.delete('host')

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer()

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstream, {
      method: req.method,
      headers,
      body: body ? body : undefined,
      signal: AbortSignal.timeout(30_000),
      // @ts-expect-error — Next.js fetch polyfill, duplex needed for streaming bodies
      duplex: 'half',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream error'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const resHeaders = new Headers(upstreamRes.headers)
  // Remove hop-by-hop headers
  resHeaders.delete('transfer-encoding')
  resHeaders.delete('connection')

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers: resHeaders,
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port, path } = await params
  return proxyRequest(req, port, path)
}

export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port, path } = await params
  return proxyRequest(req, port, path)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port, path } = await params
  return proxyRequest(req, port, path)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port, path } = await params
  return proxyRequest(req, port, path)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port, path } = await params
  return proxyRequest(req, port, path)
}
