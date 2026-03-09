import { describe, it, expect } from 'vitest'
import { BUILT_IN_TOOLS, BUILT_IN_WORKFLOWS } from '../built-in-tools'

describe('built-in-tools', () => {
  it('BUILT_IN_TOOLS is an empty array', () => {
    expect(BUILT_IN_TOOLS).toEqual([])
    expect(Array.isArray(BUILT_IN_TOOLS)).toBe(true)
  })

  it('BUILT_IN_WORKFLOWS is an empty object', () => {
    expect(BUILT_IN_WORKFLOWS).toEqual({})
    expect(typeof BUILT_IN_WORKFLOWS).toBe('object')
  })
})
