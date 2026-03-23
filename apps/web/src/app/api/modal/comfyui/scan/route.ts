import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { spawn } from 'child_process'
import { join } from 'path'
import { getComfyUIPath } from '@/lib/providerSettings'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const comfyuiPath = getComfyUIPath()
  if (!comfyuiPath) return NextResponse.json({ error: 'ComfyUI path not configured' }, { status: 400 })

  // Call modal-helper.py scan-comfyui
  const helperScript = join(process.cwd(), 'scripts', 'modal-helper.py')

  return new Promise<NextResponse>((resolve) => {
    const proc = spawn('python3', [helperScript, 'scan-comfyui', comfyuiPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    })
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', () => {
      try {
        resolve(NextResponse.json(JSON.parse(stdout.trim())))
      } catch {
        resolve(NextResponse.json({ error: 'Failed to scan ComfyUI' }, { status: 500 }))
      }
    })
    proc.on('error', () => {
      resolve(NextResponse.json({ error: 'Failed to run scanner' }, { status: 500 }))
    })
  })
}
