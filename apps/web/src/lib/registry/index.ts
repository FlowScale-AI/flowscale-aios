import type { RegistryTool } from './types'

import sdxlTxt2img from './tools/sdxl-txt2img'
import sd15Txt2img from './tools/sd15-txt2img'
import sdxlImg2img from './tools/sdxl-img2img'
import sdxlInpaint from './tools/sdxl-inpaint'
import upscaleEsrgan from './tools/upscale-esrgan'
import removeBg from './tools/remove-bg'
import controlnetCanny from './tools/controlnet-canny'
import ipadapterStyle from './tools/ipadapter-style'
import animatediffTxt2vid from './tools/animatediff-txt2vid'
import depthEstimator from './tools/depth-estimator'
import faceRestore from './tools/face-restore'

const REGISTRY: RegistryTool[] = [
  sdxlTxt2img,
  sd15Txt2img,
  sdxlImg2img,
  sdxlInpaint,
  upscaleEsrgan,
  removeBg,
  controlnetCanny,
  ipadapterStyle,
  animatediffTxt2vid,
  depthEstimator,
  faceRestore,
]

export function getAllRegistryTools(): RegistryTool[] {
  return REGISTRY
}

export function getRegistryTool(id: string): RegistryTool | undefined {
  return REGISTRY.find((t) => t.id === id)
}

export function searchRegistryTools(query: string): RegistryTool[] {
  const q = query.toLowerCase()
  return REGISTRY.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.includes(q)) ||
      t.category.includes(q),
  )
}

export function getRegistryToolsByCategory(
  category: RegistryTool['category'],
): RegistryTool[] {
  return REGISTRY.filter((t) => t.category === category)
}
