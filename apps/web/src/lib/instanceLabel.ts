export interface InstanceLabelInfo {
  customLabel?: string
  gpuName?: string
  port: number
  device?: string
}

export function getInstanceDisplayLabel(inst: InstanceLabelInfo): string {
  if (inst.customLabel) return inst.customLabel
  if (inst.gpuName) return `${inst.gpuName} :${inst.port}`
  // Legacy instances pre-dating gpuName: fall back to "GPU :port" for cuda/rocm devices
  if (inst.device && (inst.device.startsWith('cuda:') || inst.device.startsWith('rocm:'))) {
    return `GPU :${inst.port}`
  }
  return `CPU :${inst.port}`
}
