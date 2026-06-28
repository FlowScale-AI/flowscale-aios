import { describe, it, expect } from 'vitest'
import { parseAmdGpusFromRegistry } from '../gpu-detect'

// Bytes for common VRAM sizes.
const GB = (n: number) => n * 1024 * 1024 * 1024

describe('parseAmdGpusFromRegistry', () => {
  it('orders discrete GPU before iGPU regardless of registry enumeration order (HIP order)', () => {
    // The bug: registry returned iGPU first (Windows display adapter order)
    // but HIP_VISIBLE_DEVICES=0 actually points at the discrete card. Sorting
    // by VRAM descending re-orders to match HIP.
    const raw = [
      `AMD Radeon(TM) Graphics\t${GB(0.5)}`, // iGPU enumerated first
      `AMD Radeon RX 7700 XT\t${GB(12)}`, // discrete enumerated second
    ].join('\n')
    const gpus = parseAmdGpusFromRegistry(raw)
    expect(gpus).toEqual([
      { index: 0, name: 'AMD Radeon RX 7700 XT', vramMB: 12288, backend: 'rocm' },
      { index: 1, name: 'AMD Radeon(TM) Graphics', vramMB: 512, backend: 'rocm' },
    ])
  })

  it('keeps discrete-first order when registry already had it that way', () => {
    const raw = [
      `AMD Radeon RX 7700 XT\t${GB(12)}`,
      `AMD Radeon(TM) Graphics\t${GB(0.5)}`,
    ].join('\n')
    const gpus = parseAmdGpusFromRegistry(raw)
    expect(gpus.map((g) => g.name)).toEqual([
      'AMD Radeon RX 7700 XT',
      'AMD Radeon(TM) Graphics',
    ])
    expect(gpus.map((g) => g.index)).toEqual([0, 1])
  })

  it('skips non-AMD entries', () => {
    const raw = [
      `Microsoft Basic Display Adapter\t${GB(0.25)}`,
      `Intel(R) UHD Graphics\t${GB(1)}`,
      `AMD Radeon RX 7700 XT\t${GB(12)}`,
    ].join('\n')
    const gpus = parseAmdGpusFromRegistry(raw)
    expect(gpus).toHaveLength(1)
    expect(gpus[0].name).toBe('AMD Radeon RX 7700 XT')
  })

  it('handles single AMD GPU', () => {
    const raw = `AMD Radeon RX 7700 XT\t${GB(12)}`
    const gpus = parseAmdGpusFromRegistry(raw)
    expect(gpus).toEqual([
      { index: 0, name: 'AMD Radeon RX 7700 XT', vramMB: 12288, backend: 'rocm' },
    ])
  })

  it('handles three AMD GPUs in correct order', () => {
    const raw = [
      `AMD Radeon(TM) Graphics\t${GB(0.5)}`,
      `AMD Radeon RX 6600\t${GB(8)}`,
      `AMD Radeon RX 7700 XT\t${GB(12)}`,
    ].join('\n')
    const gpus = parseAmdGpusFromRegistry(raw)
    expect(gpus.map((g) => g.name)).toEqual([
      'AMD Radeon RX 7700 XT',
      'AMD Radeon RX 6600',
      'AMD Radeon(TM) Graphics',
    ])
    expect(gpus.map((g) => g.index)).toEqual([0, 1, 2])
  })

  it('skips malformed lines (missing name or VRAM)', () => {
    const raw = [
      `\t${GB(8)}`, // empty name
      `Just a name`, // missing VRAM
      `AMD Radeon RX 7700 XT\tnot-a-number`, // bad VRAM
      `AMD Radeon Pro\t${GB(16)}`, // valid
    ].join('\n')
    const gpus = parseAmdGpusFromRegistry(raw)
    expect(gpus).toEqual([
      { index: 0, name: 'AMD Radeon Pro', vramMB: 16384, backend: 'rocm' },
    ])
  })

  it('returns empty for empty input', () => {
    expect(parseAmdGpusFromRegistry('')).toEqual([])
  })

  it('matches case-insensitively for the AMD vendor filter', () => {
    const raw = [
      `ati radeon\t${GB(2)}`,
      `RADEON HD\t${GB(4)}`,
      `Amd Vega\t${GB(8)}`,
    ].join('\n')
    const gpus = parseAmdGpusFromRegistry(raw)
    expect(gpus.map((g) => g.name)).toEqual(['Amd Vega', 'RADEON HD', 'ati radeon'])
  })
})
