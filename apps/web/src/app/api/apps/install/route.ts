import { NextRequest, NextResponse } from 'next/server'
import { getRegistryEntry } from '@/lib/registry/appRegistry'
import { checkInstallDeps } from '@/lib/installer'
import { parseManifest } from '@/lib/appManifest'
import { getRequestUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { installedApps } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync, execFileSync } from 'child_process'
import { getComfyUIPath } from '@/lib/providerSettings'

const APPS_DIR = path.join(os.homedir(), '.flowscale', 'aios', 'apps')

async function downloadModel(downloadUrl: string, destPath: string): Promise<void> {
  const res = await fetch(downloadUrl, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Failed to download model: ${res.statusText}`)
  const buf = await res.arrayBuffer()
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, Buffer.from(buf))
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    id: string
    force?: boolean
    downloadModels?: boolean
    comfyPort?: number
  }
  const { id, force = false, downloadModels = false, comfyPort = 8188 } = body

  const entry = getRegistryEntry(id)
  if (!entry) return NextResponse.json({ error: 'Registry entry not found' }, { status: 404 })

  // Dependency check
  if (!force) {
    const deps = await checkInstallDeps(entry, comfyPort)
    if (!deps.ok) {
      return NextResponse.json({ status: 'missing_deps', ...deps }, { status: 200 })
    }
  }

  // Auto-download missing models if requested
  if (force && downloadModels) {
    const comfyuiPath = getComfyUIPath()
    if (!comfyuiPath) {
      return NextResponse.json({ error: 'ComfyUI installation path not configured. Set it in Providers.' }, { status: 400 })
    }

    const deps = await checkInstallDeps(entry, comfyPort)
    const downloadErrors: string[] = []

    for (const m of deps.missingModels) {
      if (!m.downloadUrl) continue
      const destPath = path.join(comfyuiPath, 'models', m.folder, m.filename)
      if (fs.existsSync(destPath)) continue
      try {
        await downloadModel(m.downloadUrl, destPath)
      } catch (err) {
        downloadErrors.push(`${m.modelLabel}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (downloadErrors.length > 0) {
      return NextResponse.json({
        error: 'Some models failed to download',
        details: downloadErrors,
      }, { status: 500 })
    }

    // Clone missing custom nodes
    const customNodesDir = path.join(comfyuiPath, 'custom_nodes')
    const venvPip = path.join(comfyuiPath, 'venv', 'bin', 'pip')
    const nodeErrors: string[] = []

    for (const node of deps.missingCustomNodes) {
      const repoName = node.repo.split('/').pop()?.replace(/\.git$/, '') ?? ''
      const destDir = path.join(customNodesDir, repoName)
      if (fs.existsSync(destDir)) continue
      try {
        execFileSync('git', ['clone', '--depth', '1', node.repo, destDir], { timeout: 120_000 })
        // Install pip requirements if present
        const reqFile = path.join(destDir, node.requirementsFile ?? 'requirements.txt')
        if (fs.existsSync(reqFile) && fs.existsSync(venvPip)) {
          execFileSync(venvPip, ['install', '-r', reqFile, '-q'], { timeout: 180_000 })
        }
      } catch (err) {
        nodeErrors.push(`${node.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (nodeErrors.length > 0) {
      return NextResponse.json({
        error: 'Some custom nodes failed to install',
        details: nodeErrors,
      }, { status: 500 })
    }
  }

  // Resolve bundle
  const assetUrl = entry.releaseAssetUrl
  const bundlePath = path.join(APPS_DIR, id)
  fs.mkdirSync(bundlePath, { recursive: true })

  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
    // Download ZIP to tmp
    const tmpFile = path.join(os.tmpdir(), `${id}-${Date.now()}.zip`)
    const res = await fetch(assetUrl)
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to download bundle: ${res.statusText}` }, { status: 502 })
    }
    const buf = await res.arrayBuffer()
    fs.writeFileSync(tmpFile, Buffer.from(buf))

    // Extract using system unzip (available on all Unix)
    const result = spawnSync('unzip', ['-o', tmpFile, '-d', bundlePath], { encoding: 'utf-8' })
    fs.unlinkSync(tmpFile)

    if (result.status !== 0) {
      return NextResponse.json({ error: 'Failed to extract bundle', detail: result.stderr }, { status: 500 })
    }
  } else {
    // Local path — copy directory
    const localPath = path.resolve(assetUrl)
    if (!fs.existsSync(localPath)) {
      return NextResponse.json({ error: `Local bundle path not found: ${localPath}` }, { status: 400 })
    }
    fs.cpSync(localPath, bundlePath, { recursive: true })
  }

  // Parse and validate manifest
  const manifestPath = path.join(bundlePath, 'flowscale.app.json')
  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json({ error: 'Bundle missing flowscale.app.json' }, { status: 400 })
  }

  let manifest
  try {
    manifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')))
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }

  const db = getDb()

  // Upsert
  const existing = await db.select().from(installedApps).where(eq(installedApps.id, id))
  if (existing.length > 0) {
    await db.update(installedApps).set({
      name: manifest.name,
      displayName: manifest.displayName,
      bundlePath,
      entryPath: manifest.entry,
      manifestJson: JSON.stringify(manifest),
      source: 'registry',
      status: 'active',
    }).where(eq(installedApps.id, id))
  } else {
    await db.insert(installedApps).values({
      id,
      name: manifest.name,
      displayName: manifest.displayName,
      bundlePath,
      entryPath: manifest.entry,
      manifestJson: JSON.stringify(manifest),
      source: 'registry',
      status: 'active',
      installedAt: Date.now(),
    })
  }

  const [app] = await db.select().from(installedApps).where(eq(installedApps.id, id))
  return NextResponse.json({ status: 'installed', app })
}
