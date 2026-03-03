import { NextRequest, NextResponse } from 'next/server'
import { analyzeWorkflow, isValidComfyWorkflow } from '@flowscale/workflow'
import { createHash } from 'crypto'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { workflowJson } = body

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

  const schema = analyzeWorkflow(parsed)
  const hash = createHash('sha256').update(workflowJson).digest('hex')

  return NextResponse.json({ schema, hash })
}
