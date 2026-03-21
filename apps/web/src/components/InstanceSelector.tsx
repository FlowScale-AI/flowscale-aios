"use client"

import { ComputePicker, type ComputePickerProps } from "./ComputePicker"

interface InstanceSelectorProps {
  instances: ComputePickerProps["instances"]
  value: ComputePickerProps["value"]
  onChange: ComputePickerProps["onChange"]
  compact?: boolean
  gpuInfo?: ComputePickerProps["gpuInfo"]
  modalConnected?: boolean
}

/**
 * Thin wrapper around ComputePicker for backwards compatibility.
 * New code should import ComputePicker directly.
 */
export function InstanceSelector({ instances, value, onChange, compact = false, gpuInfo, modalConnected }: InstanceSelectorProps) {
  return (
    <ComputePicker
      instances={instances}
      gpuInfo={gpuInfo}
      value={value}
      onChange={onChange}
      compact={compact}
      modalConnected={modalConnected}
    />
  )
}
