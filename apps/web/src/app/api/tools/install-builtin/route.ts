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
  'qwen-image-builtin': {
    id: 'qwen-image-builtin',
    name: 'Qwen Image',
    description: 'Generate high-quality images with excellent text rendering using Qwen-Image. Powered by Modal cloud GPU.',
    engine: 'api',
    workflowJson: { engine: 'api', model: 'Qwen/Qwen-Image' },
    schema: [
      { nodeId: 'api', nodeType: 'QwenImage', nodeTitle: 'Qwen Image', paramName: 'prompt', paramType: 'string', defaultValue: 'a beautiful landscape, Ultra HD, 4K, cinematic composition', label: 'Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage', nodeTitle: 'Qwen Image', paramName: 'negative_prompt', paramType: 'string', defaultValue: '', label: 'Negative Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage', nodeTitle: 'Qwen Image', paramName: 'width', paramType: 'number', defaultValue: 1328, label: 'Width', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage', nodeTitle: 'Qwen Image', paramName: 'height', paramType: 'number', defaultValue: 1328, label: 'Height', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage', nodeTitle: 'Qwen Image', paramName: 'num_inference_steps', paramType: 'number', defaultValue: 50, label: 'Steps', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage', nodeTitle: 'Qwen Image', paramName: 'true_cfg_scale', paramType: 'number', defaultValue: 4.0, label: 'True CFG Scale', isInput: true, enabled: true },
      { nodeId: 'api_output', nodeType: 'APIImageOutput', nodeTitle: 'Output', paramName: 'image', paramType: 'image', isInput: false, enabled: true },
    ],
  },
  'qwen-image-2512-builtin': {
    id: 'qwen-image-2512-builtin',
    name: 'Qwen Image 2512',
    description: 'Generate high-quality images using the updated Qwen-Image-2512 model. Powered by Modal cloud GPU.',
    engine: 'api',
    workflowJson: { engine: 'api', model: 'Qwen/Qwen-Image-2512' },
    schema: [
      { nodeId: 'api', nodeType: 'QwenImage2512', nodeTitle: 'Qwen Image 2512', paramName: 'prompt', paramType: 'string', defaultValue: 'a beautiful landscape, Ultra HD, 4K, cinematic composition', label: 'Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage2512', nodeTitle: 'Qwen Image 2512', paramName: 'negative_prompt', paramType: 'string', defaultValue: '', label: 'Negative Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage2512', nodeTitle: 'Qwen Image 2512', paramName: 'width', paramType: 'number', defaultValue: 1328, label: 'Width', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage2512', nodeTitle: 'Qwen Image 2512', paramName: 'height', paramType: 'number', defaultValue: 1328, label: 'Height', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage2512', nodeTitle: 'Qwen Image 2512', paramName: 'num_inference_steps', paramType: 'number', defaultValue: 50, label: 'Steps', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImage2512', nodeTitle: 'Qwen Image 2512', paramName: 'true_cfg_scale', paramType: 'number', defaultValue: 4.0, label: 'True CFG Scale', isInput: true, enabled: true },
      { nodeId: 'api_output', nodeType: 'APIImageOutput', nodeTitle: 'Output', paramName: 'image', paramType: 'image', isInput: false, enabled: true },
    ],
  },
  'qwen-image-edit-builtin': {
    id: 'qwen-image-edit-builtin',
    name: 'Qwen Image Edit',
    description: 'Edit images with text prompts — style transfer, object manipulation, text editing. Powered by Modal cloud GPU.',
    engine: 'api',
    workflowJson: { engine: 'api', model: 'Qwen/Qwen-Image-Edit' },
    schema: [
      { nodeId: 'api', nodeType: 'QwenImageEdit', nodeTitle: 'Qwen Image Edit', paramName: 'image', paramType: 'image', defaultValue: '', label: 'Input Image', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEdit', nodeTitle: 'Qwen Image Edit', paramName: 'mask_image', paramType: 'image', defaultValue: '', label: 'Mask (optional — white=edit, black=keep)', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEdit', nodeTitle: 'Qwen Image Edit', paramName: 'prompt', paramType: 'string', defaultValue: 'Change the background to a sunset scene', label: 'Edit Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEdit', nodeTitle: 'Qwen Image Edit', paramName: 'negative_prompt', paramType: 'string', defaultValue: '', label: 'Negative Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEdit', nodeTitle: 'Qwen Image Edit', paramName: 'num_inference_steps', paramType: 'number', defaultValue: 50, label: 'Steps', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEdit', nodeTitle: 'Qwen Image Edit', paramName: 'true_cfg_scale', paramType: 'number', defaultValue: 4.0, label: 'True CFG Scale', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEdit', nodeTitle: 'Qwen Image Edit', paramName: 'strength', paramType: 'number', defaultValue: 1.0, label: 'Mask Strength (0-1)', isInput: true, enabled: true },
      { nodeId: 'api_output', nodeType: 'APIImageOutput', nodeTitle: 'Output', paramName: 'image', paramType: 'image', isInput: false, enabled: true },
    ],
  },
  'qwen-image-edit-2511-builtin': {
    id: 'qwen-image-edit-2511-builtin',
    name: 'Qwen Image Edit Plus',
    description: 'Enhanced image editing with multi-subject support, LoRA integration, and geometric reasoning. Powered by Modal cloud GPU.',
    engine: 'api',
    workflowJson: { engine: 'api', model: 'Qwen/Qwen-Image-Edit-2511' },
    schema: [
      { nodeId: 'api', nodeType: 'QwenImageEditPlus', nodeTitle: 'Qwen Image Edit Plus', paramName: 'image', paramType: 'image', defaultValue: '', label: 'Input Image', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEditPlus', nodeTitle: 'Qwen Image Edit Plus', paramName: 'mask_image', paramType: 'image', defaultValue: '', label: 'Mask (optional — white=edit, black=keep)', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEditPlus', nodeTitle: 'Qwen Image Edit Plus', paramName: 'prompt', paramType: 'string', defaultValue: 'Transform the character into a fantasy wizard', label: 'Edit Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEditPlus', nodeTitle: 'Qwen Image Edit Plus', paramName: 'negative_prompt', paramType: 'string', defaultValue: '', label: 'Negative Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEditPlus', nodeTitle: 'Qwen Image Edit Plus', paramName: 'num_inference_steps', paramType: 'number', defaultValue: 40, label: 'Steps', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEditPlus', nodeTitle: 'Qwen Image Edit Plus', paramName: 'guidance_scale', paramType: 'number', defaultValue: 1.0, label: 'Guidance Scale', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEditPlus', nodeTitle: 'Qwen Image Edit Plus', paramName: 'true_cfg_scale', paramType: 'number', defaultValue: 4.0, label: 'True CFG Scale', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageEditPlus', nodeTitle: 'Qwen Image Edit Plus', paramName: 'strength', paramType: 'number', defaultValue: 1.0, label: 'Mask Strength (0-1)', isInput: true, enabled: true },
      { nodeId: 'api_output', nodeType: 'APIImageOutput', nodeTitle: 'Output', paramName: 'image', paramType: 'image', isInput: false, enabled: true },
    ],
  },
  'qwen-image-layered-builtin': {
    id: 'qwen-image-layered-builtin',
    name: 'Qwen Image Layered',
    description: 'Decompose images into editable RGBA layers. Each layer can be independently manipulated. Powered by Modal cloud GPU.',
    engine: 'api',
    workflowJson: { engine: 'api', model: 'Qwen/Qwen-Image-Layered' },
    schema: [
      { nodeId: 'api', nodeType: 'QwenImageLayered', nodeTitle: 'Qwen Image Layered', paramName: 'image', paramType: 'image', defaultValue: '', label: 'Input Image', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageLayered', nodeTitle: 'Qwen Image Layered', paramName: 'layers', paramType: 'number', defaultValue: 4, label: 'Number of Layers', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageLayered', nodeTitle: 'Qwen Image Layered', paramName: 'resolution', paramType: 'number', defaultValue: 640, label: 'Resolution', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageLayered', nodeTitle: 'Qwen Image Layered', paramName: 'num_inference_steps', paramType: 'number', defaultValue: 50, label: 'Steps', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'QwenImageLayered', nodeTitle: 'Qwen Image Layered', paramName: 'true_cfg_scale', paramType: 'number', defaultValue: 4.0, label: 'True CFG Scale', isInput: true, enabled: true },
      { nodeId: 'api_output', nodeType: 'APIImageOutput', nodeTitle: 'Output', paramName: 'image', paramType: 'image', isInput: false, enabled: true },
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
