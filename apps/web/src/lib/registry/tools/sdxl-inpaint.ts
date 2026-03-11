import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'sdxl-inpaint',
  name: 'SDXL Inpainting',
  description: 'Fill masked regions of an image using text guidance with SDXL.',
  category: 'editing',
  tags: ['sdxl', 'inpaint', 'mask', 'stable-diffusion'],
  version: '1.0.0',
  requiredModels: [
    {
      folder: 'checkpoints',
      filename: 'sd_xl_base_1.0_inpainting_0.1.safetensors',
      label: 'SDXL Inpainting 0.1',
      downloadUrl: 'https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1',
    },
  ],
  schema: [
    { nodeId: '10', nodeType: 'LoadImage', nodeTitle: 'Input Image', paramName: 'image', paramType: 'image', isInput: true },
    { nodeId: '20', nodeType: 'LoadImageMask', nodeTitle: 'Mask', paramName: 'image', paramType: 'image', isInput: true },
    { nodeId: '6', nodeType: 'CLIPTextEncode', nodeTitle: 'Prompt (what to fill)', paramName: 'text', paramType: 'string', defaultValue: 'a beautiful sky', isInput: true },
    { nodeId: '7', nodeType: 'CLIPTextEncode', nodeTitle: 'Negative Prompt', paramName: 'text', paramType: 'string', defaultValue: 'blurry, bad quality', isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Seed', paramName: 'seed', paramType: 'number', defaultValue: 0, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Steps', paramName: 'steps', paramType: 'number', defaultValue: 25, isInput: true },
    { nodeId: '9', nodeType: 'SaveImage', nodeTitle: 'Output Image', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0_inpainting_0.1.safetensors' } },
    '10': { class_type: 'LoadImage', inputs: { image: 'input.png', upload: 'image' } },
    '20': { class_type: 'LoadImageMask', inputs: { image: 'mask.png', channel: 'red', upload: 'image' } },
    '11': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['10', 0], vae: ['4', 2], mask: ['20', 0], grow_mask_by: 6 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a beautiful sky', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, bad quality', clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0], seed: 0, steps: 25, cfg: 7.0, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'FlowScale' } },
  },
}

export default tool
