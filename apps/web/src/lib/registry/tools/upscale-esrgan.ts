import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'upscale-esrgan',
  name: '4x ESRGAN Upscale',
  description: 'Upscale images 4x using Real-ESRGAN for crisp, clean results.',
  category: 'enhancement',
  tags: ['upscale', 'esrgan', 'super-resolution'],
  version: '1.0.0',
  requiredModels: [
    {
      folder: 'upscale_models',
      filename: 'RealESRGAN_x4plus.pth',
      label: 'RealESRGAN x4 Plus',
      downloadUrl: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
    },
  ],
  schema: [
    { nodeId: '10', nodeType: 'LoadImage', nodeTitle: 'Input Image', paramName: 'image', paramType: 'image', isInput: true },
    { nodeId: '11', nodeType: 'ImageUpscaleWithModel', nodeTitle: 'Output Image', paramName: 'image', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '10': { class_type: 'LoadImage', inputs: { image: 'input.png', upload: 'image' } },
    '12': { class_type: 'UpscaleModelLoader', inputs: { model_name: 'RealESRGAN_x4plus.pth' } },
    '11': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['12', 0], image: ['10', 0] } },
    '13': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: 'FlowScale_upscaled' } },
  },
}

export default tool
