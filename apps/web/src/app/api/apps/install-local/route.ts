import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { parseManifest } from '@/lib/appManifest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

const APPS_DIR = path.join(os.homedir(), '.flowscale', 'apps')

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'dev'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { path: string }
  const sourcePath = body.path?.trim()
  if (!sourcePath) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 })
  }

  if (!fs.existsSync(sourcePath)) {
    return NextResponse.json({ error: `Path not found: ${sourcePath}` }, { status: 400 })
  }

  // Find manifest
  const manifestPath = path.join(sourcePath, 'flowscale.app.json')
  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json(
      { error: 'No flowscale.app.json found in the selected folder' },
      { status: 400 },
    )
  }

  // Build if needed
  const packageJsonPath = path.join(sourcePath, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    if (pkg.scripts?.build) {
      const distDir = path.join(sourcePath, 'dist')
      if (!fs.existsSync(distDir)) {
        try {
          const usePnpm = fs.existsSync(path.join(sourcePath, 'pnpm-lock.yaml'))
          const useYarn = fs.existsSync(path.join(sourcePath, 'yarn.lock'))
          const installCmd = usePnpm ? 'pnpm install' : useYarn ? 'yarn install' : 'npm install'
          const buildCmd = usePnpm ? 'pnpm run build' : useYarn ? 'yarn build' : 'npm run build'

          const opts = { cwd: sourcePath, stdio: 'pipe' as const, timeout: 120_000 }
          execSync(installCmd, opts)
          execSync(buildCmd, opts)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return NextResponse.json({ error: `Build failed: ${msg}` }, { status: 500 })
        }
      }
    }
  }

  // Validate manifest
  let manifest
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    manifest = parseManifest(raw)
  } catch (err) {
    return NextResponse.json({ error: `Invalid manifest: ${err}` }, { status: 400 })
  }

  // Determine bundle: dist/ if exists, otherwise the folder itself
  const distDir = path.join(sourcePath, 'dist')
  const bundleSource = fs.existsSync(distDir) ? distDir : sourcePath

  // Copy to ~/.flowscale/apps/{name}/
  const appId = manifest.name
  const destDir = path.join(APPS_DIR, appId)

  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true })
  }
  fs.mkdirSync(destDir, { recursive: true })

  fs.cpSync(bundleSource, destDir, { recursive: true })

  // Ensure manifest is in the bundle root
  const destManifest = path.join(destDir, 'flowscale.app.json')
  if (!fs.existsSync(destManifest)) {
    fs.copyFileSync(manifestPath, destManifest)
  }

  // Rewrite absolute asset paths to relative in entry HTML
  const entryHtml = path.join(destDir, manifest.entry)
  if (fs.existsSync(entryHtml) && manifest.entry.endsWith('.html')) {
    let html = fs.readFileSync(entryHtml, 'utf-8')
    // Convert absolute paths like src="/assets/..." or href="/assets/..." to relative
    const rewritten = html.replace(/(src|href)="\/(?!\/)/g, '$1="./')
    if (rewritten !== html) {
      fs.writeFileSync(entryHtml, rewritten, 'utf-8')
    }
  }

  return NextResponse.json({ status: 'installed', id: appId })
}
