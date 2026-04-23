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

  it('returns CPU :port when neither customLabel nor gpuName', () => {
    expect(getInstanceDisplayLabel({ port: 41189 }))
      .toBe('CPU :41189')
  })

  it('treats empty string customLabel as unset', () => {
    expect(getInstanceDisplayLabel({ customLabel: '', gpuName: 'RTX 4090', port: 41188 }))
      .toBe('RTX 4090 :41188')
  })
})
