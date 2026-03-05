import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage and window before importing module
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })
Object.defineProperty(globalThis, 'window', {
  value: globalThis,
  writable: true,
})

describe('platform', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  it('getComfyUIUrl returns default when localStorage is empty', async () => {
    const { getComfyUIUrl } = await import('../platform')
    expect(getComfyUIUrl()).toBe('http://localhost:8188')
  })

  it('setComfyUIUrl stores URL and getComfyUIUrl retrieves it', async () => {
    const { getComfyUIUrl, setComfyUIUrl } = await import('../platform')
    setComfyUIUrl('http://localhost:9999')
    expect(getComfyUIUrl()).toBe('http://localhost:9999')
  })

  it('isDesktop returns false when window.desktop is undefined', async () => {
    const { isDesktop } = await import('../platform')
    expect(isDesktop()).toBe(false)
  })

  it('isDesktop returns true when window.desktop.isDesktop is true', async () => {
    ;(globalThis as any).desktop = { isDesktop: true }
    const { isDesktop } = await import('../platform')
    expect(isDesktop()).toBe(true)
    delete (globalThis as any).desktop
  })

  it('isDesktop returns false when window.desktop.isDesktop is false', async () => {
    ;(globalThis as any).desktop = { isDesktop: false }
    const { isDesktop } = await import('../platform')
    expect(isDesktop()).toBe(false)
    delete (globalThis as any).desktop
  })
})
