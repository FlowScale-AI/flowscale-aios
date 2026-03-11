import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'controlnet-canny',
  name: 'ControlNet Canny',
  description: 'Generate images guided by edge detection from a reference image using ControlNet Canny.',
  category: 'generation',
  tags: ['controlnet', 'canny', 'edges', 'guided-generation'],
  version: '1.0.0',
  requiredModels: [
    {
      folder: 'checkpoints',
      filename: 'v1-5-pruned-emaonly.ckpt',
      label: 'SD 1.5 Base',
      downloadUrl: 'https://huggingface.co/runwayml/stable-diffusion-v1-5',
    },
    {
      folder: 'controlnet',
      filename: 'control_v11p_sd15_canny.pth',
      label: 'ControlNet Canny (SD 1.5)',
      downloadUrl: 'https://huggingface.co/lllyasviel/control_v11p_sd15_canny',
    },
  ],
  schema: [
    { nodeId: '10', nodeType: 'LoadImage', nodeTitle: 'Reference Image', paramName: 'image', paramType: 'image', isInput: true },
    { nodeId: '6', nodeType: 'CLIPTextEncode', nodeTitle: 'Positive Prompt', paramName: 'text', paramType: 'string', defaultValue: 'a detailed building, architecture', isInput: true },
    { nodeId: '7', nodeType: 'CLIPTextEncode', nodeTitle: 'Negative Prompt', paramName: 'text', paramType: 'string', defaultValue: 'blurry, bad quality', isInput: true },
    { nodeId: '14', nodeType: 'CannyEdgePreprocessor', nodeTitle: 'Canny Low Threshold', paramName: 'low_threshold', paramType: 'number', defaultValue: 100, isInput: true },
    { nodeId: '14', nodeType: 'CannyEdgePreprocessor', nodeTitle: 'Canny High Threshold', paramName: 'high_threshold', paramType: 'number', defaultValue: 200, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Seed', paramName: 'seed', paramType: 'number', defaultValue: 0, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Steps', paramName: 'steps', paramType: 'number', defaultValue: 20, isInput: true },
    { nodeId: '9', nodeType: 'SaveImage', nodeTitle: 'Output Image', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.ckpt' } },
    '10': { class_type: 'LoadImage', inputs: { image: 'input.png', upload: 'image' } },
    '14': { class_type: 'CannyEdgePreprocessor', inputs: { image: ['10', 0], low_threshold: 100, high_threshold: 200, resolution: 512 } },
    '15': { class_type: 'ControlNetLoader', inputs: { control_net_name: 'control_v11p_sd15_canny.pth' } },
    '16': { class_type: 'ControlNetApply', inputs: { conditioning: ['6', 0], control_net: ['15', 0], image: ['14', 0], strength: 1.0 } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a detailed building, architecture', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, bad quality', clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['16', 0], negative: ['7', 0], latent_image: ['5', 0], seed: 0, steps: 20, cfg: 7.0, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'FlowScale' } },
  },
}

export default tool
