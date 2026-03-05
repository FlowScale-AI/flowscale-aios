import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock localStorage
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, val: string) => { store[key] = val }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k in store) delete store[k] }),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })
Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true })

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

import { usePodsStore } from '../podsStore'

describe('podsStore', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    localStorageMock.clear()
    // Reset store state
    usePodsStore.setState({
      pods: [],
      selectedPodId: null,
      isLoading: false,
      operatorUrl: null,
    })
  })

  it('initial state has empty pods and no selection', () => {
    const state = usePodsStore.getState()
    expect(state.pods).toEqual([])
    expect(state.selectedPodId).toBeNull()
    expect(state.isLoading).toBe(false)
  })

  it('setSelectedPodId updates selection', () => {
    usePodsStore.getState().setSelectedPodId('local:8188')
    expect(usePodsStore.getState().selectedPodId).toBe('local:8188')
  })

  it('setSelectedPodId can clear selection', () => {
    usePodsStore.getState().setSelectedPodId('local:8188')
    usePodsStore.getState().setSelectedPodId(null)
    expect(usePodsStore.getState().selectedPodId).toBeNull()
  })

  it('setOperatorUrl stores in localStorage and triggers refresh', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    })
    usePodsStore.getState().setOperatorUrl('http://operator:30000')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('flowscale:operatorUrl', 'http://operator:30000')
    expect(usePodsStore.getState().operatorUrl).toBe('http://operator:30000')
  })

  it('setOperatorUrl with null removes from localStorage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    })
    usePodsStore.getState().setOperatorUrl(null)
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('flowscale:operatorUrl')
    expect(usePodsStore.getState().operatorUrl).toBeNull()
  })

  it('setOperatorUrl with empty/whitespace string normalizes to null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    })
    usePodsStore.getState().setOperatorUrl('   ')
    expect(usePodsStore.getState().operatorUrl).toBeNull()
  })

  it('setOperatorUrl resets pods and selectedPodId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    })
    usePodsStore.setState({ pods: [{ id: 'x', name: 'x', instances: [] }], selectedPodId: 'x' })
    usePodsStore.getState().setOperatorUrl('http://new:30000')
    expect(usePodsStore.getState().pods).toEqual([])
    expect(usePodsStore.getState().selectedPodId).toBeNull()
  })

  it('refreshPods sets loading, fetches, and creates pods from running instances', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { port: 8188, status: 'running' },
        { port: 8189, status: 'running' },
      ]),
    })
    await usePodsStore.getState().refreshPods()
    const state = usePodsStore.getState()
    expect(state.isLoading).toBe(false)
    expect(state.pods.length).toBe(2)
    expect(state.pods[0].id).toBe('local:8188')
    expect(state.pods[0].name).toBe('ComfyUI :8188')
    expect(state.pods[0].instances[0].port).toBe(8188)
    expect(state.selectedPodId).toBe('local:8188')
  })

  it('refreshPods auto-selects first pod when no previous selection', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ port: 9000, status: 'running' }]),
    })
    await usePodsStore.getState().refreshPods()
    expect(usePodsStore.getState().selectedPodId).toBe('local:9000')
  })

  it('refreshPods preserves existing selection if valid', async () => {
    usePodsStore.setState({ selectedPodId: 'local:8188' })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ port: 8188, status: 'running' }]),
    })
    await usePodsStore.getState().refreshPods()
    expect(usePodsStore.getState().selectedPodId).toBe('local:8188')
  })

  it('refreshPods filters out non-running instances', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { port: 8188, status: 'running' },
        { port: 8189, status: 'stopped' },
        { port: 8190, status: 'error' },
      ]),
    })
    await usePodsStore.getState().refreshPods()
    expect(usePodsStore.getState().pods.length).toBe(1)
    expect(usePodsStore.getState().pods[0].id).toBe('local:8188')
  })

  it('refreshPods handles no running instances', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ port: 8188, status: 'stopped' }]),
    })
    await usePodsStore.getState().refreshPods()
    expect(usePodsStore.getState().pods).toEqual([])
    expect(usePodsStore.getState().selectedPodId).toBeNull()
  })

  it('refreshPods handles non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })
    await usePodsStore.getState().refreshPods()
    expect(usePodsStore.getState().isLoading).toBe(false)
    expect(usePodsStore.getState().pods).toEqual([])
  })

  it('refreshPods handles fetch error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    await usePodsStore.getState().refreshPods()
    expect(usePodsStore.getState().isLoading).toBe(false)
    consoleSpy.mockRestore()
  })

  it('refreshPods handles empty response array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    })
    await usePodsStore.getState().refreshPods()
    expect(usePodsStore.getState().pods).toEqual([])
    expect(usePodsStore.getState().selectedPodId).toBeNull()
  })
})
