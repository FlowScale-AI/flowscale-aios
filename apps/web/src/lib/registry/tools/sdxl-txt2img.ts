import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'sdxl-txt2img',
  name: 'SDXL Text to Image',
  description: 'Generate high-quality images from text prompts using Stable Diffusion XL.',
  category: 'generation',
  tags: ['sdxl', 'text-to-image', 'stable-diffusion'],
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
    { nodeId: '6', nodeType: 'CLIPTextEncode', nodeTitle: 'Positive Prompt', paramName: 'text', paramType: 'string', defaultValue: 'beautiful landscape, professional photography', isInput: true },
    { nodeId: '7', nodeType: 'CLIPTextEncode', nodeTitle: 'Negative Prompt', paramName: 'text', paramType: 'string', defaultValue: 'blurry, bad quality, watermark', isInput: true },
    { nodeId: '5', nodeType: 'EmptyLatentImage', nodeTitle: 'Image Size', paramName: 'width', paramType: 'number', defaultValue: 1024, isInput: true },
    { nodeId: '5', nodeType: 'EmptyLatentImage', nodeTitle: 'Image Size', paramName: 'height', paramType: 'number', defaultValue: 1024, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Sampler', paramName: 'seed', paramType: 'number', defaultValue: 0, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Sampler', paramName: 'steps', paramType: 'number', defaultValue: 20, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Sampler', paramName: 'cfg', paramType: 'number', defaultValue: 7.0, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Sampler', paramName: 'sampler_name', paramType: 'select', defaultValue: 'euler', options: ['euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral', 'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_2m', 'ddim', 'uni_pc'], isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Sampler', paramName: 'scheduler', paramType: 'select', defaultValue: 'normal', options: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform'], isInput: true },
    { nodeId: '9', nodeType: 'SaveImage', nodeTitle: 'Output Image', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'beautiful landscape, professional photography', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, bad quality, watermark', clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: 0, steps: 20, cfg: 7.0, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'FlowScale' } },
  },
}

export default tool
