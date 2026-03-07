import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'sdxl-img2img',
  name: 'SDXL Image to Image',
  description: 'Transform an existing image using text guidance with SDXL.',
  category: 'editing',
  tags: ['sdxl', 'img2img', 'stable-diffusion'],
  version: '1.0.0',
  requiredModels: [
    {
      folder: 'checkpoints',
      filename: 'sd_xl_base_1.0.safetensors',
      label: 'SDXL Base 1.0',
      downloadUrl: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0',
    },
  ],
  schema: [
    { nodeId: '10', nodeType: 'LoadImage', nodeTitle: 'Input Image', paramName: 'image', paramType: 'image', isInput: true },
    { nodeId: '6', nodeType: 'CLIPTextEncode', nodeTitle: 'Positive Prompt', paramName: 'text', paramType: 'string', defaultValue: 'beautiful landscape, professional photography', isInput: true },
    { nodeId: '7', nodeType: 'CLIPTextEncode', nodeTitle: 'Negative Prompt', paramName: 'text', paramType: 'string', defaultValue: 'blurry, bad quality', isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Denoise Strength', paramName: 'denoise', paramType: 'number', defaultValue: 0.75, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Seed', paramName: 'seed', paramType: 'number', defaultValue: 0, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Steps', paramName: 'steps', paramType: 'number', defaultValue: 20, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'CFG Scale', paramName: 'cfg', paramType: 'number', defaultValue: 7.0, isInput: true },
    { nodeId: '9', nodeType: 'SaveImage', nodeTitle: 'Output Image', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
    '10': { class_type: 'LoadImage', inputs: { image: 'input.png', upload: 'image' } },
    '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'beautiful landscape, professional photography', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, bad quality', clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0], seed: 0, steps: 20, cfg: 7.0, sampler_name: 'euler', scheduler: 'normal', denoise: 0.75 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'FlowScale' } },
  },
}

export default tool
