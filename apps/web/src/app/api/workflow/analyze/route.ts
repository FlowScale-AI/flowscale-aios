import { NextRequest, NextResponse } from 'next/server'
import { analyzeWorkflow, isValidComfyWorkflow, normalizeWorkflow, type ObjectInfoMap } from '@flowscale/workflow'
import { createHash } from 'crypto'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { workflowJson, comfyPort } = body

  if (!workflowJson || typeof workflowJson !== 'string') {
    return NextResponse.json({ error: 'workflowJson string required' }, { status: 400 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(workflowJson)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isValidComfyWorkflow(parsed)) {
    return NextResponse.json({ error: 'Not a valid ComfyUI workflow' }, { status: 422 })
  }

  // If a ComfyUI port is provided, fetch /object_info to resolve custom node
  // widget params during graph→API conversion. Falls back to static table on error.
  let objectInfoMap: ObjectInfoMap | undefined
  if (comfyPort && typeof comfyPort === 'number') {
    try {
      const infoRes = await fetch(`http://localhost:${comfyPort}/object_info`, {
        signal: AbortSignal.timeout(3000),
      })
      if (infoRes.ok) objectInfoMap = await infoRes.json() as ObjectInfoMap
    } catch { /* unreachable — proceed without */ }
  }

  const schema = analyzeWorkflow(
    normalizeWorkflow(parsed as Parameters<typeof normalizeWorkflow>[0], objectInfoMap)
  )
  const hash = createHash('sha256').update(workflowJson).digest('hex')

  return NextResponse.json({ schema, hash })
}
