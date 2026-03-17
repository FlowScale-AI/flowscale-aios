import { NextRequest, NextResponse } from 'next/server'
import { readdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

/**
 * GET /api/outputs/search?filenames=foo.png,bar.png
 * Searches ~/.flowscale/aios-outputs/ for files matching the given filenames
 * and returns a map of filename → persistent /api/outputs/ path.
 */
export async function GET(req: NextRequest) {
  const filenames = req.nextUrl.searchParams.get('filenames')?.split(',').filter(Boolean)
  if (!filenames?.length) return NextResponse.json({})

  const baseDir = join(homedir(), '.flowscale', 'aios-outputs')
  const result: Record<string, string> = {}

  try {
    const toolDirs = await readdir(baseDir, { withFileTypes: true })
    for (const dir of toolDirs) {
      if (!dir.isDirectory()) continue
      const files = await readdir(join(baseDir, dir.name)).catch(() => [] as string[])
      for (const file of files) {
        // Output files are stored as {execId_8chars}_{originalFilename}
        const origName = file.replace(/^[a-f0-9]{8}_/, '')
        if (filenames.includes(origName) && !result[origName]) {
          result[origName] = `/api/outputs/${dir.name}/${file}`
        }
      }
    }
  } catch {
    // outputs dir may not exist
  }

  return NextResponse.json(result)
}
