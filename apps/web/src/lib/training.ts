import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

export function getDatasetsDir(): string {
  return join(homedir(), '.flowscale', 'training-datasets')
}

export function getDatasetDir(id: string): string {
  return join(getDatasetsDir(), id)
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png'])

export interface DatasetMeta {
  id: string
  name: string
  triggerWord: string
  createdAt: number
}

export interface DatasetImage {
  name: string
  caption: string | null
}

export interface DatasetDetail extends DatasetMeta {
  images: DatasetImage[]
}

export function createDataset(opts: { name: string; triggerWord: string }): DatasetMeta {
  const datasetsDir = getDatasetsDir()
  mkdirSync(datasetsDir, { recursive: true })
  const id = randomUUID().slice(0, 8)
  const dir = join(datasetsDir, id)
  mkdirSync(dir, { recursive: true })

  const meta: DatasetMeta = {
    id,
    name: opts.name,
    triggerWord: opts.triggerWord,
    createdAt: Date.now(),
  }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  return meta
}

export function listDatasets(): DatasetMeta[] {
  const datasetsDir = getDatasetsDir()
  if (!existsSync(datasetsDir)) return []

  const results: DatasetMeta[] = []
  for (const entry of readdirSync(datasetsDir)) {
    const metaPath = join(datasetsDir, entry, 'meta.json')
    if (!existsSync(metaPath)) continue
    try {
      results.push(JSON.parse(readFileSync(metaPath, 'utf-8')) as DatasetMeta)
    } catch { /* skip malformed */ }
  }
  return results.sort((a, b) => b.createdAt - a.createdAt)
}

export function getDataset(id: string): DatasetDetail | null {
  const dir = join(getDatasetsDir(), id)
  const metaPath = join(dir, 'meta.json')
  if (!existsSync(metaPath)) return null

  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as DatasetMeta
  const files = readdirSync(dir)

  const images: DatasetImage[] = []
  for (const f of files) {
    const ext = f.substring(f.lastIndexOf('.')).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    const baseName = f.substring(0, f.lastIndexOf('.'))
    const captionPath = join(dir, `${baseName}.txt`)
    const caption = existsSync(captionPath) ? readFileSync(captionPath, 'utf-8').trim() : null
    images.push({ name: f, caption })
  }

  return { ...meta, images }
}

export function updateDatasetMeta(id: string, updates: Partial<Pick<DatasetMeta, 'name' | 'triggerWord'>>): void {
  const dir = join(getDatasetsDir(), id)
  const metaPath = join(dir, 'meta.json')
  if (!existsSync(metaPath)) throw new Error(`Dataset "${id}" not found`)

  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as DatasetMeta
  if (updates.name !== undefined) meta.name = updates.name
  if (updates.triggerWord !== undefined) meta.triggerWord = updates.triggerWord
  writeFileSync(metaPath, JSON.stringify(meta, null, 2))
}

export function updateCaption(datasetId: string, imageName: string, caption: string): void {
  const dir = join(getDatasetsDir(), datasetId)
  const baseName = imageName.substring(0, imageName.lastIndexOf('.'))
  writeFileSync(join(dir, `${baseName}.txt`), caption)
}

export function deleteDataset(id: string): void {
  const dir = join(getDatasetsDir(), id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

export interface DatasetSyncStatus {
  synced: boolean
  fileCount?: number
  syncedAt?: number
}

export function getDatasetSyncStatus(id: string): DatasetSyncStatus {
  const dir = getDatasetDir(id)
  const syncFile = join(dir, '.modal-synced')
  if (!existsSync(syncFile)) return { synced: false }
  const syncData = JSON.parse(readFileSync(syncFile, 'utf-8')) as { fileCount: number; syncedAt: number }
  const currentCount = countDatasetFiles(dir)
  if (currentCount !== syncData.fileCount) return { synced: false }
  return { synced: true, fileCount: syncData.fileCount, syncedAt: syncData.syncedAt }
}

export function markDatasetSynced(id: string): void {
  const dir = getDatasetDir(id)
  const count = countDatasetFiles(dir)
  writeFileSync(join(dir, '.modal-synced'), JSON.stringify({ fileCount: count, syncedAt: Date.now() }))
}

function countDatasetFiles(dir: string): number {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter(f => {
    const ext = f.substring(f.lastIndexOf('.')).toLowerCase()
    return ['.jpg', '.jpeg', '.png', '.txt'].includes(ext)
  }).length
}
