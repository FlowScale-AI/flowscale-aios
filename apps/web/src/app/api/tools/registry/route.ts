import { NextRequest, NextResponse } from 'next/server'
import { getAllRegistryTools, searchRegistryTools, getRegistryToolsByCategory } from '@/lib/registry'
import type { RegistryTool } from '@/lib/registry/types'
import { getRequestUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q')
  const category = searchParams.get('category') as RegistryTool['category'] | null
  const ids = searchParams.get('ids')

  let results = getAllRegistryTools()

  if (ids) {
    const idSet = new Set(ids.split(',').map((s) => s.trim()))
    results = results.filter((t) => idSet.has(t.id))
  } else if (category) {
    results = getRegistryToolsByCategory(category)
  } else if (q) {
    results = searchRegistryTools(q)
  }

  // Strip workflowJson from list responses to keep payload small
  const includeWorkflow = searchParams.get('workflow') === '1'
  const response = includeWorkflow
    ? results
    : results.map(({ workflowJson: _wf, ...rest }) => rest)

  return NextResponse.json(response)
}
