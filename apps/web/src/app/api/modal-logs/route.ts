import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'

/**
 * GET /api/modal-logs?appName=z-image-turbo
 *
 * Runs `modal app logs <appName> --no-follow` and returns the last 150 lines.
 * Times out after 8s in case --no-follow is unsupported and the process streams.
 */
export async function GET(req: NextRequest) {
  const appName = req.nextUrl.searchParams.get('appName')
  if (!appName || !/^[\w-]+$/.test(appName)) {
    return NextResponse.json({ error: 'Invalid appName' }, { status: 400 })
  }

  const lines: string[] = []

  await new Promise<void>((resolve) => {
    const proc = spawn('modal', ['app', 'logs', appName], { stdio: 'pipe' })

    const collect = (data: Buffer) => {
      data.toString().split('\n').forEach((l) => { if (l.trim()) lines.push(l) })
    }
    proc.stdout?.on('data', collect)
    proc.stderr?.on('data', collect)

    // Safety timeout — kill if --no-follow isn't honoured
    const timer = setTimeout(() => { proc.kill(); resolve() }, 8000)
    proc.on('close', () => { clearTimeout(timer); resolve() })
  })

  return NextResponse.json({ logs: lines.slice(-150) })
}
