import fs from 'fs'
import path from 'path'

/**
 * Writes JSON data atomically by writing to a temp file first, then renaming.
 * Prevents corruption if the process crashes mid-write.
 */
export function atomicWriteJsonSync(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`)
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore cleanup error */ }
    throw err
  }
}
