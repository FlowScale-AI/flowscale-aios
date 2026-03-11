import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'remove-bg',
  name: 'Background Removal',
  description: 'Remove the background from any image using BRIA RMBG, producing a transparent PNG.',
  category: 'utility',
  tags: ['background', 'remove', 'transparent', 'matting'],
  version: '1.0.0',
  requiredModels: [
    {
      folder: 'rembg',
      filename: 'RMBG-1.4.pth',
      label: 'BRIA RMBG 1.4',
      downloadUrl: 'https://huggingface.co/briaai/RMBG-1.4',
    },
  ],
  schema: [
    { nodeId: '10', nodeType: 'LoadImage', nodeTitle: 'Input Image', paramName: 'image', paramType: 'image', isInput: true },
    { nodeId: '13', nodeType: 'SaveImage', nodeTitle: 'Output (no background)', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '10': { class_type: 'LoadImage', inputs: { image: 'input.png', upload: 'image' } },
    '11': { class_type: 'BRIA_RMBG_ModelLoader', inputs: {} },
    '12': { class_type: 'BRIA_RMBG', inputs: { model: ['11', 0], image: ['10', 0] } },
    '13': { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'FlowScale_nobg' } },
  },
}

export default tool
