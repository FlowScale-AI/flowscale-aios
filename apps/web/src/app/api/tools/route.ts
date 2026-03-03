import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { tools } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export async function GET(req: NextRequest) {
  const db = getDb()
  const status = req.nextUrl.searchParams.get('status')

  const rows = status
    ? await db.select().from(tools).where(eq(tools.status, status))
    : await db.select().from(tools)

  // Sort by createdAt desc
  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const db = getDb()
  const body = await req.json()

  const { name, description, workflowJson, workflowHash, schemaJson, layout, comfyPort } = body

  if (!name || !workflowJson || !workflowHash || !schemaJson) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const id = uuidv4()
  const now = Date.now()

  await db.insert(tools).values({
    id,
    name,
    description: description ?? null,
    workflowJson,
    workflowHash,
    schemaJson,
    layout: layout ?? 'left-right',
    status: 'dev',
    comfyPort: comfyPort ?? null,
    createdAt: now,
  })

  const [tool] = await db.select().from(tools).where(eq(tools.id, id))
  return NextResponse.json(tool, { status: 201 })
}
