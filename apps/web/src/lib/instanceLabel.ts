export interface InstanceLabelInfo {
  customLabel?: string
  gpuName?: string
  port: number
}

export function getInstanceDisplayLabel(inst: InstanceLabelInfo): string {
  if (inst.customLabel) return inst.customLabel
  if (inst.gpuName) return `${inst.gpuName} :${inst.port}`
  return `CPU :${inst.port}`
}
