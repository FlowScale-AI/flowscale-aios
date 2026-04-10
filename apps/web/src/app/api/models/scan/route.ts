import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { models } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { scanComfyModels } from '@/lib/modelScanner'

export async function POST(req: NextRequest) {
  const body = await req.json() as { comfyPort: number }
  const { comfyPort } = body

  if (!comfyPort || typeof comfyPort !== 'number') {
    return NextResponse.json({ error: 'comfyPort required' }, { status: 400 })
  }

  const scanned = await scanComfyModels(comfyPort)
  if (scanned.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const db = getDb()

  // Remove stale entries for this port then insert fresh — wrap in a
  // transaction so a failure mid-insert doesn't leave the table half-empty.
  // Note: better-sqlite3 transactions are synchronous, so no async/await inside.
  db.transaction((tx) => {
    tx.delete(models).where(eq(models.comfyPort, comfyPort)).run()

    for (const m of scanned) {
      tx
        .insert(models)
        .values({
          id: m.id,
          filename: m.filename,
          path: m.path,
          type: m.type,
          sizeBytes: m.sizeBytes,
          comfyPort: m.comfyPort,
          scannedAt: m.scannedAt,
        })
        .onConflictDoUpdate({
          target: models.id,
          set: { filename: m.filename, scannedAt: m.scannedAt },
        })
        .run()
    }
  })

  return NextResponse.json({ count: scanned.length })
}
