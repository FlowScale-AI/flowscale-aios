import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { parseManifest } from '@/lib/appManifest'
import { parseGitHubUrl } from '@/lib/github'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { extract } from 'tar'

const APPS_DIR = path.join(os.homedir(), '.flowscale', 'apps')

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'dev'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { url: string }
  const url = body.url?.trim()
  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  const parsed = parseGitHubUrl(url)
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid GitHub URL. Expected: https://github.com/owner/repo' },
      { status: 400 },
    )
  }

  const tmpDir = path.join(os.tmpdir(), `flowscale-install-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    // Download tarball from GitHub
    const tarballUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/tarball${parsed.branch ? `/${parsed.branch}` : ''}`
    const res = await fetch(tarballUrl, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FlowScale-AIOS' },
      redirect: 'follow',
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to download from GitHub: ${res.status} ${res.statusText}` },
        { status: 502 },
      )
    }

    // Extract tarball (limit to 200MB)
    const MAX_TARBALL_BYTES = 200 * 1024 * 1024
    const tarballPath = path.join(tmpDir, 'repo.tar.gz')
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength > MAX_TARBALL_BYTES) {
      return NextResponse.json(
        { error: `Tarball too large (${Math.round(buffer.byteLength / 1024 / 1024)}MB). Max: 200MB` },
        { status: 400 },
      )
    }
    fs.writeFileSync(tarballPath, buffer)

    await extract({ file: tarballPath, cwd: tmpDir })

    // GitHub tarballs extract to {owner}-{repo}-{sha}/ prefix
    const extracted = fs.readdirSync(tmpDir).filter((f) => {
      const p = path.join(tmpDir, f)
      return fs.statSync(p).isDirectory()
    })

    if (extracted.length === 0) {
      return NextResponse.json({ error: 'Tarball extracted no directories' }, { status: 500 })
    }

    let sourceDir = path.join(tmpDir, extracted[0])

    // Navigate into subdir if specified
    if (parsed.subdir) {
      sourceDir = path.join(sourceDir, parsed.subdir)
      if (!fs.existsSync(sourceDir)) {
        return NextResponse.json(
          { error: `Subdirectory "${parsed.subdir}" not found in repo` },
          { status: 400 },
        )
      }
    }

    // Find and validate manifest
    const manifestPath = path.join(sourceDir, 'flowscale.app.json')
    if (!fs.existsSync(manifestPath)) {
      return NextResponse.json(
        { error: 'No flowscale.app.json found in repository root' },
        { status: 400 },
      )
    }

    // Build if needed
    const packageJsonPath = path.join(sourceDir, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      if (pkg.scripts?.build) {
        try {
          // Detect package manager from lockfile
          const useYarn = fs.existsSync(path.join(sourceDir, 'yarn.lock'))
          const usePnpm = fs.existsSync(path.join(sourceDir, 'pnpm-lock.yaml'))

          const installCmd = usePnpm
            ? 'pnpm install --ignore-scripts'
            : useYarn
              ? 'yarn install --ignore-scripts'
              : 'npm install --ignore-scripts'
          const buildCmd = usePnpm ? 'pnpm run build' : useYarn ? 'yarn build' : 'npm run build'

          const opts = { cwd: sourceDir, stdio: 'pipe' as const, timeout: 120_000 }
          execSync(installCmd, opts)
          execSync(buildCmd, opts)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return NextResponse.json({ error: `Build failed: ${msg}` }, { status: 500 })
        }
      }
    }

    // Determine bundle directory: dist/ if exists, otherwise sourceDir
    const distDir = path.join(sourceDir, 'dist')
    const bundleSource = fs.existsSync(distDir) ? distDir : sourceDir

    // Validate manifest
    let manifest
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      manifest = parseManifest(raw)
    } catch (err) {
      return NextResponse.json({ error: `Invalid manifest: ${err}` }, { status: 400 })
    }

    // Copy to ~/.flowscale/apps/{name}/
    const appId = manifest.name
    const destDir = path.join(APPS_DIR, appId)

    // Remove existing if present
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true })
    }
    fs.mkdirSync(destDir, { recursive: true })

    // Copy bundle contents
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
      const rewritten = html.replace(/(src|href)="\/(?!\/)/g, '$1="./')
      if (rewritten !== html) {
        fs.writeFileSync(entryHtml, rewritten, 'utf-8')
      }
    }

    return NextResponse.json({ status: 'installed', id: appId })
  } finally {
    // Cleanup temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}
