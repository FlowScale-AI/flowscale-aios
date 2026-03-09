import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'ipadapter-style',
  name: 'IP-Adapter Style Transfer',
  description: 'Apply the visual style of a reference image to a new generation using IP-Adapter.',
  category: 'editing',
  tags: ['ipadapter', 'style-transfer', 'reference'],
  version: '1.0.0',
  requiredModels: [
    {
      folder: 'checkpoints',
      filename: 'sd_xl_base_1.0.safetensors',
      label: 'SDXL Base 1.0',
      downloadUrl: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0',
    },
    {
      folder: 'ipadapter',
      filename: 'ip-adapter_sdxl.safetensors',
      label: 'IP-Adapter SDXL',
      downloadUrl: 'https://huggingface.co/h94/IP-Adapter',
    },
    {
      folder: 'clip_vision',
      filename: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors',
      label: 'CLIP ViT-H',
      downloadUrl: 'https://huggingface.co/h94/IP-Adapter',
    },
  ],
  schema: [
    { nodeId: '10', nodeType: 'LoadImage', nodeTitle: 'Style Reference Image', paramName: 'image', paramType: 'image', isInput: true },
    { nodeId: '6', nodeType: 'CLIPTextEncode', nodeTitle: 'Positive Prompt', paramName: 'text', paramType: 'string', defaultValue: 'a portrait in the style of the reference', isInput: true },
    { nodeId: '7', nodeType: 'CLIPTextEncode', nodeTitle: 'Negative Prompt', paramName: 'text', paramType: 'string', defaultValue: 'blurry, bad quality', isInput: true },
    { nodeId: '17', nodeType: 'IPAdapterApply', nodeTitle: 'Style Weight', paramName: 'weight', paramType: 'number', defaultValue: 0.8, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Seed', paramName: 'seed', paramType: 'number', defaultValue: 0, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Steps', paramName: 'steps', paramType: 'number', defaultValue: 25, isInput: true },
    { nodeId: '9', nodeType: 'SaveImage', nodeTitle: 'Output Image', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
    '10': { class_type: 'LoadImage', inputs: { image: 'reference.png', upload: 'image' } },
    '15': { class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: 'ip-adapter_sdxl.safetensors' } },
    '16': { class_type: 'CLIPVisionLoader', inputs: { clip_name: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors' } },
    '17': { class_type: 'IPAdapterApply', inputs: { ipadapter: ['15', 0], clip_vision: ['16', 0], image: ['10', 0], model: ['4', 0], weight: 0.8, noise: 0.0, weight_type: 'original', start_at: 0.0, end_at: 1.0, unfold_batch: false } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a portrait in the style of the reference', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, bad quality', clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { model: ['17', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: 0, steps: 25, cfg: 6.0, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1.0 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'FlowScale' } },
  },
}

export default tool
