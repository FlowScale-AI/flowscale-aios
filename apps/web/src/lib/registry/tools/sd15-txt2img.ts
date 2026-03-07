import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'sd15-txt2img',
  name: 'SD 1.5 Text to Image',
  description: 'Generate images from text prompts using Stable Diffusion 1.5 — widely compatible with LoRAs and extensions.',
  category: 'generation',
  tags: ['sd15', 'text-to-image', 'stable-diffusion'],
  version: '1.0.0',
  requiredModels: [
    {
      folder: 'checkpoints',
      filename: 'v1-5-pruned-emaonly.ckpt',
      label: 'SD 1.5 (pruned emaonly)',
      downloadUrl: 'https://huggingface.co/runwayml/stable-diffusion-v1-5',
    },
  ],
  schema: [
    { nodeId: '6', nodeType: 'CLIPTextEncode', nodeTitle: 'Positive Prompt', paramName: 'text', paramType: 'string', defaultValue: 'a photo of a cat', isInput: true },
    { nodeId: '7', nodeType: 'CLIPTextEncode', nodeTitle: 'Negative Prompt', paramName: 'text', paramType: 'string', defaultValue: 'ugly, blurry, low quality', isInput: true },
    { nodeId: '5', nodeType: 'EmptyLatentImage', nodeTitle: 'Width', paramName: 'width', paramType: 'number', defaultValue: 512, isInput: true },
    { nodeId: '5', nodeType: 'EmptyLatentImage', nodeTitle: 'Height', paramName: 'height', paramType: 'number', defaultValue: 512, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Seed', paramName: 'seed', paramType: 'number', defaultValue: 0, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Steps', paramName: 'steps', paramType: 'number', defaultValue: 20, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'CFG Scale', paramName: 'cfg', paramType: 'number', defaultValue: 7.0, isInput: true },
    { nodeId: '9', nodeType: 'SaveImage', nodeTitle: 'Output Image', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.ckpt' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a photo of a cat', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'ugly, blurry, low quality', clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: 0, steps: 20, cfg: 7.0, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'FlowScale' } },
  },
}

export default tool
