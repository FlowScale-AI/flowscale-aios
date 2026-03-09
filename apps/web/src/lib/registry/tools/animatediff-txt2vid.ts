import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'animatediff-txt2vid',
  name: 'AnimateDiff Text to Video',
  description: 'Generate short animated clips from text prompts using AnimateDiff.',
  category: 'video',
  tags: ['animatediff', 'text-to-video', 'animation', 'gif'],
  version: '1.0.0',
  requiredModels: [
    {
      folder: 'checkpoints',
      filename: 'dreamshaper_8.safetensors',
      label: 'DreamShaper 8',
      downloadUrl: 'https://civitai.com/models/4384/dreamshaper',
    },
    {
      folder: 'animatediff_models',
      filename: 'mm_sd_v15_v2.ckpt',
      label: 'AnimateDiff Motion Module v2',
      downloadUrl: 'https://huggingface.co/guoyww/animatediff',
    },
  ],
  schema: [
    { nodeId: '6', nodeType: 'CLIPTextEncode', nodeTitle: 'Positive Prompt', paramName: 'text', paramType: 'string', defaultValue: 'a cat walking in a park, high quality, smooth motion', isInput: true },
    { nodeId: '7', nodeType: 'CLIPTextEncode', nodeTitle: 'Negative Prompt', paramName: 'text', paramType: 'string', defaultValue: 'blurry, bad quality, static', isInput: true },
    { nodeId: '20', nodeType: 'ADE_AnimateDiffSamplingSettings', nodeTitle: 'Frame Count', paramName: 'context_length', paramType: 'number', defaultValue: 16, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Seed', paramName: 'seed', paramType: 'number', defaultValue: 0, isInput: true },
    { nodeId: '3', nodeType: 'KSampler', nodeTitle: 'Steps', paramName: 'steps', paramType: 'number', defaultValue: 20, isInput: true },
    { nodeId: '21', nodeType: 'VHS_VideoCombine', nodeTitle: 'Output Video', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'dreamshaper_8.safetensors' } },
    '18': { class_type: 'ADE_LoadAnimateDiffModel', inputs: { model_name: 'mm_sd_v15_v2.ckpt' } },
    '19': { class_type: 'ADE_ApplyAnimateDiffModel', inputs: { motion_model: ['18', 0], model: ['4', 0], motion_scale: 1.0 } },
    '20': { class_type: 'ADE_AnimateDiffSamplingSettings', inputs: { motion_model_settings: ['19', 1], context_length: 16, context_stride: 1, context_overlap: 4, context_schedule: 'uniform', closed_loop: false } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 16 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat walking in a park, high quality, smooth motion', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, bad quality, static', clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { model: ['19', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: 0, steps: 20, cfg: 7.0, sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1.0 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '21': { class_type: 'VHS_VideoCombine', inputs: { images: ['8', 0], frame_rate: 8, loop_count: 0, filename_prefix: 'FlowScale_anim', format: 'image/gif', pingpong: false, save_output: true } },
  },
}

export default tool
