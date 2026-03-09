import { describe, it, expect } from 'vitest'
import { axios } from '../axios'

describe('axios instance', () => {
  it('is configured with baseURL /', () => {
    expect(axios.defaults.baseURL).toBe('/')
  })

  it('has a response interceptor that unwraps .data', () => {
    // The interceptor is at index 0
    const interceptors = (axios.interceptors.response as any).handlers
    expect(interceptors.length).toBeGreaterThan(0)
    // Test the fulfilled handler
    const handler = interceptors[0].fulfilled
    const mockResponse = { data: { foo: 'bar' }, status: 200 }
    expect(handler(mockResponse)).toEqual({ foo: 'bar' })
  })

  it('has a response interceptor that rejects errors', async () => {
    const interceptors = (axios.interceptors.response as any).handlers
    const handler = interceptors[0].rejected
    const error = new Error('test error')
    await expect(handler(error)).rejects.toThrow('test error')
  })
})
