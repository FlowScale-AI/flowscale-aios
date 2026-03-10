import { NextRequest, NextResponse } from 'next/server'

const UPSTREAM = process.env.REPORT_ISSUE_URL ?? 'https://flowscale.ai/api/report-issue'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to submit report' },
      { status: 500 },
    )
  }
}
