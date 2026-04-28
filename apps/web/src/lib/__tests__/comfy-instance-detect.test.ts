import { describe, it, expect } from 'vitest'
import {
  buildInstancesFromDetection,
  instancesEqual,
} from '../comfy-instance-detect'
import type { GpuInfo } from '../gpu-detect'
import type { ComfyInstanceConfig } from '../providerSettings'

describe('buildInstancesFromDetection', () => {
  const basePort = 41188
  const gpu7700: GpuInfo = {
    index: 0,
    name: 'AMD Radeon RX 7700 XT',
    vramMB: 12288,
    backend: 'rocm',
  }
  const gpuIgpu: GpuInfo = {
    index: 1,
    name: 'AMD Radeon(TM) Graphics',
    vramMB: 512,
    backend: 'rocm',
  }
  const gpu4090: GpuInfo = {
    index: 0,
    name: 'NVIDIA RTX 4090',
    vramMB: 24576,
    backend: 'cuda',
  }

  it('builds instances for one GPU + CPU when nothing existed', () => {
    const result = buildInstancesFromDetection([gpu7700], [], basePort)
    expect(result).toEqual([
      {
        id: 'gpu-0',
        port: 41188,
        device: 'rocm:0',
        label: 'GPU 0 — AMD Radeon RX 7700 XT',
        gpuName: 'AMD Radeon RX 7700 XT',
      },
      { id: 'cpu', port: 41189, device: 'cpu', label: 'CPU' },
    ])
  })

  it('uses cuda prefix for NVIDIA backend', () => {
    const result = buildInstancesFromDetection([gpu4090], [], basePort)
    expect(result[0].device).toBe('cuda:0')
    expect(result[0].gpuName).toBe('NVIDIA RTX 4090')
  })

  it('preserves launchScriptId for matched gpu and cpu instances', () => {
    const existing: ComfyInstanceConfig[] = [
      { id: 'gpu-0', port: 41188, device: 'rocm:0', label: 'old', launchScriptId: 'script-a' },
      { id: 'cpu', port: 41189, device: 'cpu', label: 'CPU', launchScriptId: 'script-b' },
    ]
    const result = buildInstancesFromDetection([gpu7700], existing, basePort)
    expect(result[0].launchScriptId).toBe('script-a')
    expect(result[1].launchScriptId).toBe('script-b')
  })

  it('preserves customLabel for matched gpu instance', () => {
    const existing: ComfyInstanceConfig[] = [
      { id: 'gpu-0', port: 41188, device: 'rocm:0', label: 'old', customLabel: 'Image Gen' },
    ]
    const result = buildInstancesFromDetection([gpu7700], existing, basePort)
    expect(result[0].customLabel).toBe('Image Gen')
  })

  it('does not carry over customizations to a different gpu id', () => {
    // Existing gpu-0 has launchScriptId; detection now reports a GPU at
    // index 1 instead. The new instance gets id "gpu-1" and should NOT
    // inherit gpu-0's launch script.
    const existing: ComfyInstanceConfig[] = [
      { id: 'gpu-0', port: 41188, device: 'rocm:0', label: 'old', launchScriptId: 'script-a' },
    ]
    const result = buildInstancesFromDetection([gpuIgpu], existing, basePort)
    expect(result[0].id).toBe('gpu-1')
    expect(result[0].launchScriptId).toBeUndefined()
  })

  it('multiple GPUs get sequential ports + correct device strings', () => {
    const result = buildInstancesFromDetection([gpu7700, gpuIgpu], [], basePort)
    expect(result.map((i) => ({ id: i.id, port: i.port, device: i.device }))).toEqual([
      { id: 'gpu-0', port: 41188, device: 'rocm:0' },
      { id: 'gpu-1', port: 41189, device: 'rocm:1' },
      { id: 'cpu', port: 41190, device: 'cpu' },
    ])
  })

  it('updates gpuName when GPU at the same index has changed name (HIP swap fix)', () => {
    // Field-reported scenario: registry first reported iGPU at rocm:0, but
    // after the parseAmdGpusFromRegistry sort fix, the discrete card lands at
    // rocm:0. The instance config gets the corrected gpuName.
    const existing: ComfyInstanceConfig[] = [
      { id: 'gpu-0', port: 41188, device: 'rocm:0', label: 'GPU 0 — iGPU', gpuName: 'AMD Radeon(TM) Graphics' },
    ]
    const result = buildInstancesFromDetection([gpu7700], existing, basePort)
    expect(result[0].gpuName).toBe('AMD Radeon RX 7700 XT')
    expect(result[0].label).toBe('GPU 0 — AMD Radeon RX 7700 XT')
  })

  it('always emits a CPU instance even when no GPUs detected', () => {
    const result = buildInstancesFromDetection([], [], basePort)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('cpu')
    expect(result[0].port).toBe(basePort)
  })
})

describe('instancesEqual', () => {
  const inst = (over: Partial<ComfyInstanceConfig> = {}): ComfyInstanceConfig => ({
    id: 'gpu-0',
    port: 41188,
    device: 'rocm:0',
    label: 'GPU 0 — AMD Radeon RX 7700 XT',
    gpuName: 'AMD Radeon RX 7700 XT',
    ...over,
  })

  it('returns true for identical lists', () => {
    expect(instancesEqual([inst()], [inst()])).toBe(true)
  })

  it('returns false for different length', () => {
    expect(instancesEqual([inst()], [inst(), inst({ id: 'cpu' })])).toBe(false)
  })

  it('returns false when gpuName differs', () => {
    expect(instancesEqual([inst({ gpuName: 'A' })], [inst({ gpuName: 'B' })])).toBe(false)
  })

  it('returns false when device differs', () => {
    expect(instancesEqual([inst({ device: 'rocm:0' })], [inst({ device: 'rocm:1' })])).toBe(false)
  })

  it('returns false when port differs', () => {
    expect(instancesEqual([inst({ port: 41188 })], [inst({ port: 41189 })])).toBe(false)
  })

  it('returns false when launchScriptId differs', () => {
    expect(
      instancesEqual([inst({ launchScriptId: 'a' })], [inst({ launchScriptId: 'b' })]),
    ).toBe(false)
  })

  it('treats undefined and missing customLabel as equal', () => {
    expect(instancesEqual([inst()], [inst({ customLabel: undefined })])).toBe(true)
  })
})
