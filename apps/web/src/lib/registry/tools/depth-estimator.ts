import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'depth-estimator',
  name: 'Depth Map Estimator',
  description: 'Generate a depth map from any image using MiDaS — useful as a ControlNet preprocessor.',
  category: 'utility',
  tags: ['depth', 'midas', 'preprocessor', 'controlnet'],
  version: '1.0.0',
  requiredModels: [],
  schema: [
    { nodeId: '10', nodeType: 'LoadImage', nodeTitle: 'Input Image', paramName: 'image', paramType: 'image', isInput: true },
    { nodeId: '12', nodeType: 'SaveImage', nodeTitle: 'Depth Map', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '10': { class_type: 'LoadImage', inputs: { image: 'input.png', upload: 'image' } },
    '11': { class_type: 'MiDaS-DepthMapPreprocessor', inputs: { image: ['10', 0], a: 6.283185307179586, bg_threshold: 0.1, resolution: 512 } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: 'FlowScale_depth' } },
  },
}

export default tool
