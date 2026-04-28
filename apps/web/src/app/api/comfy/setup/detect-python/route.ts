/**
 * GET /api/comfy/setup/detect-python?root=<path>
 *
 * Probes a ComfyUI Desktop user-data folder (or any root) for a bundled venv
 * Python executable. Used by the setup wizard to show the user which Python
 * AIOS will spawn before they hit Connect — making a wrong user-data path
 * obvious upfront.
 *
 * Returns { pythonPath: string | null }
 */

import { type NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import os from 'os'
import path from 'path'

function expandEnvVars(input: string): string {
  if (!input) return input
  let out = input
  if (out.startsWith('~')) out = os.homedir() + out.slice(1)
  out = out.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? `%${name}%`)
  out = out.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (_m, name: string) => process.env[name] ?? `$${name}`)
  return out
}

export async function GET(req: NextRequest) {
  const root = req.nextUrl.searchParams.get('root')
  if (!root) {
    return NextResponse.json({ error: 'root query param required' }, { status: 400 })
  }
  const expanded = expandEnvVars(root)
  const isWin = process.platform === 'win32'
  const candidates = isWin
    ? [
        path.join(expanded, '.venv', 'Scripts', 'python.exe'),
        path.join(expanded, 'venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(expanded, '.venv', 'bin', 'python3'),
        path.join(expanded, '.venv', 'bin', 'python'),
        path.join(expanded, 'venv', 'bin', 'python3'),
        path.join(expanded, 'venv', 'bin', 'python'),
      ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return NextResponse.json({ pythonPath: candidate })
    }
  }
  return NextResponse.json({ pythonPath: null })
}
