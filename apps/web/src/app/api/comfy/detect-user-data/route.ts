/**
 * Auto-detects the ComfyUI Desktop App user-data directory by checking
 * well-known locations for the presence of models/ or custom_nodes/.
 */

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

function isComfyUserDataDir(dir: string): boolean {
  if (!fs.existsSync(dir)) return false
  return (
    fs.existsSync(path.join(dir, 'models')) ||
    fs.existsSync(path.join(dir, 'custom_nodes')) ||
    fs.existsSync(path.join(dir, 'user'))
  )
}

export async function GET() {
  const home = os.homedir()
  const platform = process.platform

  const candidates: string[] = []

  if (platform === 'darwin') {
    candidates.push(
      path.join(home, 'ComfyUI'),
      path.join(home, '.comfyui'),
      path.join(home, 'Library', 'Application Support', 'ComfyUI'),
    )
  } else if (platform === 'win32') {
    candidates.push(
      path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'ComfyUI'),
      path.join(home, 'ComfyUI'),
    )
  } else {
    // Linux
    candidates.push(
      path.join(home, 'comfyui'),
      path.join(home, 'ComfyUI'),
      path.join(home, '.comfyui'),
    )
  }

  const detected = candidates.find(isComfyUserDataDir)

  return NextResponse.json({
    detected: detected || null,
    candidates: candidates.map((c) => ({ path: c, exists: fs.existsSync(c) })),
  })
}
