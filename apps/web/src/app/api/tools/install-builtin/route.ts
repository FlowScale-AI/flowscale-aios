import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { tools } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'
import { getRequestUser } from '@/lib/auth'

const BUILTIN_DEFINITIONS: Record<string, {
  id: string
  name: string
  description: string
  engine: string
  workflowJson: object
  schema: object[]
}> = {
  'z-image-turbo-builtin': {
    id: 'z-image-turbo-builtin',
    name: 'Z-Image Turbo',
    description: 'Generate high-quality images locally using Z-Image Turbo. Runs on your GPU — no API key needed.',
    engine: 'api',
    workflowJson: { engine: 'api', model: 'Tongyi-MAI/Z-Image-Turbo' },
    schema: [
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'prompt', paramType: 'string', defaultValue: 'a beautiful landscape', label: 'Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'negative_prompt', paramType: 'string', defaultValue: '', label: 'Negative Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'width', paramType: 'number', defaultValue: 1024, label: 'Width', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'height', paramType: 'number', defaultValue: 1024, label: 'Height', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'num_inference_steps', paramType: 'number', defaultValue: 4, label: 'Steps', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'guidance_scale', paramType: 'number', defaultValue: 0, label: 'Guidance Scale', isInput: true, enabled: true },
      { nodeId: 'api_output', nodeType: 'APIImageOutput', nodeTitle: 'Output', paramName: 'image', paramType: 'image', isInput: false, enabled: true },
    ],
  },
  'ltx-video-builtin': {
    id: 'ltx-video-builtin',
    name: 'LTX Video 2.3',
    description: 'Generate videos from text prompts using the LTX-2.3 22B model. Powered by Modal cloud GPU.',
    engine: 'api',
    workflowJson: { engine: 'api', model: 'Lightricks/LTX-2.3' },
    schema: [
      { nodeId: 'api', nodeType: 'LTXVideo', nodeTitle: 'LTX Video 2.3', paramName: 'prompt', paramType: 'string', defaultValue: 'A cat walking across a sunlit garden path', label: 'Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'LTXVideo', nodeTitle: 'LTX Video 2.3', paramName: 'width', paramType: 'number', defaultValue: 768, label: 'Width', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'LTXVideo', nodeTitle: 'LTX Video 2.3', paramName: 'height', paramType: 'number', defaultValue: 512, label: 'Height', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'LTXVideo', nodeTitle: 'LTX Video 2.3', paramName: 'num_frames', paramType: 'number', defaultValue: 65, label: 'Frames', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'LTXVideo', nodeTitle: 'LTX Video 2.3', paramName: 'frame_rate', paramType: 'number', defaultValue: 25, label: 'Frame Rate', isInput: true, enabled: true },
      { nodeId: 'api_output', nodeType: 'APIVideoOutput', nodeTitle: 'Output', paramName: 'video', paramType: 'video', isInput: false, enabled: true },
    ],
  },
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  const def = BUILTIN_DEFINITIONS[id]
  if (!def) return NextResponse.json({ error: 'Unknown builtin tool' }, { status: 404 })

  const db = getDb()
  const existing = await db.select().from(tools).where(eq(tools.id, def.id))
  if (existing.length > 0) return NextResponse.json(existing[0])

  const workflowJson = JSON.stringify(def.workflowJson)
  const workflowHash = crypto.createHash('sha256').update(workflowJson).digest('hex')

  await db.insert(tools).values({
    id: def.id,
    name: def.name,
    description: def.description,
    engine: def.engine,
    workflowJson,
    workflowHash,
    schemaJson: JSON.stringify(def.schema),
    layout: 'left-right',
    status: 'production',
    createdAt: Date.now(),
  })

  const [tool] = await db.select().from(tools).where(eq(tools.id, def.id))
  return NextResponse.json(tool, { status: 201 })
}
