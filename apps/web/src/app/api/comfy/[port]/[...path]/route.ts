import { NextRequest, NextResponse } from 'next/server'

type Params = { port: string; path: string[] }

async function proxyRequest(req: NextRequest, port: string): Promise<NextResponse> {
  const url = new URL(req.url)
  // Use url.pathname directly to preserve any percent-encoded characters (e.g. %2F).
  // The decoded [...path] param would turn %2F into a real slash, breaking paths
  // like /userdata/workflows%2Ffile.json that ComfyUI expects as a single segment.
  const prefix = `/api/comfy/${port}/`
  const rawPath = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
  const upstream = `http://127.0.0.1:${port}/${rawPath}${url.search}`

  const headers = new Headers(req.headers)
  headers.delete('host')
  headers.delete('origin')
  headers.delete('referer')

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
  const { port } = await params
  return proxyRequest(req, port)
}

export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port } = await params
  return proxyRequest(req, port)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port } = await params
  return proxyRequest(req, port)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port } = await params
  return proxyRequest(req, port)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port } = await params
  return proxyRequest(req, port)
}
