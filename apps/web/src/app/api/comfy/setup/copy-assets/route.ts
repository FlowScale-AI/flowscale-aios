/**
 * Copies custom_nodes from a ComfyUI Desktop App's user-data folder into the
 * AIOS-managed ComfyUI installation, and writes an extra_model_paths.yaml that
 * points ComfyUI to the desktop app's models directory (avoiding large copies).
 */

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getComfyManagedPath, getComfyDesktopUserDataPath } from '@/lib/providerSettings'

function copyDirRecursive(src: string, dest: string): { copied: number } {
  let copied = 0
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copied += copyDirRecursive(srcPath, destPath).copied
    } else {
      fs.copyFileSync(srcPath, destPath)
      copied++
    }
  }
  return { copied }
}

export async function POST() {
  const managedPath = getComfyManagedPath()
  const desktopDataPath = getComfyDesktopUserDataPath()

  if (!managedPath) {
    return NextResponse.json({ error: 'managedPath not configured' }, { status: 400 })
  }
  if (!desktopDataPath) {
    return NextResponse.json({ error: 'desktopUserDataPath not configured' }, { status: 400 })
  }
  if (!fs.existsSync(managedPath)) {
    return NextResponse.json({ error: `Managed ComfyUI path not found: ${managedPath}` }, { status: 400 })
  }
  if (!fs.existsSync(desktopDataPath)) {
    return NextResponse.json({ error: `Desktop user-data path not found: ${desktopDataPath}` }, { status: 400 })
  }

  const results: Record<string, unknown> = {}

  // ── Custom nodes ────────────────────────────────────────────────────────────
  const srcCustomNodes = path.join(desktopDataPath, 'custom_nodes')
  if (fs.existsSync(srcCustomNodes)) {
    const destCustomNodes = path.join(managedPath, 'custom_nodes')
    const { copied } = copyDirRecursive(srcCustomNodes, destCustomNodes)
    results.customNodesCopied = copied
  } else {
    results.customNodesCopied = 0
  }

  // ── extra_model_paths.yaml — point to desktop's model folders ───────────────
  // We write a YAML that tells ComfyUI to look in the desktop user-data dir
  // for all model types.  This avoids copying potentially hundreds of GBs.
  const modelsDir = path.join(desktopDataPath, 'models')
  if (fs.existsSync(modelsDir)) {
    const yaml = [
      'comfyui:',
      `  base_path: ${desktopDataPath}`,
      '  checkpoints: models/checkpoints/',
      '  loras: models/loras/',
      '  vae: models/vae/',
      '  controlnet: models/controlnet/',
      '  upscale_models: models/upscale_models/',
      '  clip: models/clip/',
      '  unet: models/unet/',
      '  diffusion_models: models/diffusion_models/',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(managedPath, 'extra_model_paths.yaml'), yaml, 'utf-8')
    results.modelPathsConfigured = true
  } else {
    results.modelPathsConfigured = false
  }

  // ── Config files (user.json, comfy.settings.json, etc.) ─────────────────────
  const configFiles = ['user.json', 'comfy.settings.json', 'extra_model_paths.yaml']
  let configsCopied = 0
  for (const cf of configFiles) {
    const src = path.join(desktopDataPath, cf)
    // Don't overwrite the extra_model_paths.yaml we just wrote above
    if (cf === 'extra_model_paths.yaml') continue
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(managedPath, cf))
      configsCopied++
    }
  }
  results.configsCopied = configsCopied

  return NextResponse.json({ success: true, ...results })
}
