import type { RegistryTool } from '../types'

const tool: RegistryTool = {
  id: 'face-restore',
  name: 'Face Restoration',
  description: 'Restore and enhance faces in images using GFPGAN or CodeFormer.',
  category: 'enhancement',
  tags: ['face', 'restore', 'gfpgan', 'codeformer', 'enhancement'],
  version: '1.0.0',
  requiredModels: [
    {
      folder: 'facerestore_models',
      filename: 'codeformer-v0.1.0.pth',
      label: 'CodeFormer v0.1.0',
      downloadUrl: 'https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth',
    },
    {
      folder: 'facedetection',
      filename: 'detection_Resnet50_Final.pth',
      label: 'RetinaFace Detection',
      downloadUrl: 'https://github.com/xinntao/facexlib/releases/download/v0.1.0/detection_Resnet50_Final.pth',
    },
  ],
  schema: [
    { nodeId: '10', nodeType: 'LoadImage', nodeTitle: 'Input Image', paramName: 'image', paramType: 'image', isInput: true },
    { nodeId: '11', nodeType: 'FaceRestoreCFWithModel', nodeTitle: 'Restore Fidelity', paramName: 'codeformer_fidelity', paramType: 'number', defaultValue: 0.7, isInput: true },
    { nodeId: '12', nodeType: 'SaveImage', nodeTitle: 'Restored Image', paramName: 'images', paramType: 'image', isInput: false },
  ],
  workflowJson: {
    '10': { class_type: 'LoadImage', inputs: { image: 'input.png', upload: 'image' } },
    '13': { class_type: 'FaceRestoreModelLoader', inputs: { model_name: 'codeformer-v0.1.0.pth' } },
    '11': { class_type: 'FaceRestoreCFWithModel', inputs: { facerestore_model: ['13', 0], image: ['10', 0], codeformer_fidelity: 0.7, facedetection: 'retinaface_resnet50' } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: 'FlowScale_restored' } },
  },
}

export default tool
