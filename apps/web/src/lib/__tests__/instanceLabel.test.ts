import { describe, it, expect } from 'vitest'
import { getInstanceDisplayLabel } from '../instanceLabel'

describe('getInstanceDisplayLabel', () => {
  it('returns customLabel when set', () => {
    expect(getInstanceDisplayLabel({ customLabel: 'Image Gen', gpuName: 'RTX 4090', port: 41188 }))
      .toBe('Image Gen')
  })

  it('returns gpuName :port when no customLabel', () => {
    expect(getInstanceDisplayLabel({ gpuName: 'RTX 4090', port: 41188 }))
      .toBe('RTX 4090 :41188')
  })

  it('returns CPU :port when neither customLabel nor gpuName and no device', () => {
    expect(getInstanceDisplayLabel({ port: 41189 }))
      .toBe('CPU :41189')
  })

  it('returns GPU :port for cuda device without gpuName (legacy instance)', () => {
    expect(getInstanceDisplayLabel({ port: 41188, device: 'cuda:0' }))
      .toBe('GPU :41188')
  })

  it('returns GPU :port for rocm device without gpuName (legacy instance)', () => {
    expect(getInstanceDisplayLabel({ port: 41190, device: 'rocm:1' }))
      .toBe('GPU :41190')
  })

  it('treats empty string customLabel as unset', () => {
    expect(getInstanceDisplayLabel({ customLabel: '', gpuName: 'RTX 4090', port: 41188 }))
      .toBe('RTX 4090 :41188')
  })
})
