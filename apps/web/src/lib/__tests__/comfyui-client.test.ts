import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock platform module
vi.mock('../platform', () => ({
  getComfyUIUrl: () => 'http://localhost:8188',
}))

// Mock global fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Mock WebSocket
class MockWebSocket {
  url: string
  onmessage: ((evt: any) => void) | null = null
  onerror: ((evt: any) => void) | null = null
  readyState = 1 // OPEN
  close = vi.fn()

  constructor(url: string) {
    this.url = url
  }
}
;(globalThis as any).WebSocket = MockWebSocket
;(MockWebSocket as any).OPEN = 1
;(MockWebSocket as any).CONNECTING = 0

import {
  listWorkflows,
  loadWorkflow,
  getObjectInfo,
  uploadImage,
  queuePrompt,
  getHistory,
  getOutputUrl,
  saveWorkflow,
  checkConnection,
  connectWS,
} from '../comfyui-client'

describe('comfyui-client', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('getOutputUrl', () => {
    it('builds correct URL with defaults', () => {
      const url = getOutputUrl('image.png')
      expect(url).toContain('http://localhost:8188/view?')
      expect(url).toContain('filename=image.png')
      expect(url).toContain('type=output')
    })

    it('includes subfolder and type', () => {
      const url = getOutputUrl('img.png', 'sub', 'temp')
      expect(url).toContain('subfolder=sub')
      expect(url).toContain('type=temp')
    })

    it('uses custom baseUrl', () => {
      const url = getOutputUrl('img.png', '', 'output', 'http://custom:9000')
      expect(url).toContain('http://custom:9000/view?')
    })
  })

  describe('listWorkflows', () => {
    it('fetches workflow list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(['wf1.json', 'wf2.json']),
      })
      const result = await listWorkflows()
      expect(result).toEqual(['wf1.json', 'wf2.json'])
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8188/api/userdata?dir=workflows',
        undefined,
      )
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
      await expect(listWorkflows()).rejects.toThrow('ComfyUI')
    })
  })

  describe('loadWorkflow', () => {
    it('fetches a specific workflow by filename', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ nodes: [] }),
      })
      const result = await loadWorkflow('test.json')
      expect(result).toEqual({ nodes: [] })
      expect(mockFetch.mock.calls[0][0]).toContain(encodeURIComponent('workflows/test.json'))
    })
  })

  describe('getObjectInfo', () => {
    it('fetches object info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ KSampler: {} }),
      })
      const result = await getObjectInfo()
      expect(result).toEqual({ KSampler: {} })
    })
  })

  describe('uploadImage', () => {
    it('uploads a file and returns filename', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'uploaded.png', subfolder: '', type: 'input' }),
      })
      const file = new File(['content'], 'photo.png', { type: 'image/png' })
      const result = await uploadImage(file)
      expect(result).toBe('uploaded.png')
      expect(mockFetch.mock.calls[0][1].method).toBe('POST')
    })
  })

  describe('queuePrompt', () => {
    it('queues a prompt and returns prompt_id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ prompt_id: 'abc-123' }),
      })
      const result = await queuePrompt({ '1': {} }, 'client1')
      expect(result).toBe('abc-123')
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.client_id).toBe('client1')
    })
  })

  describe('getHistory', () => {
    it('fetches history for a prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ 'abc-123': { outputs: {} } }),
      })
      const result = await getHistory('abc-123')
      expect(result).toHaveProperty('abc-123')
    })
  })

  describe('saveWorkflow', () => {
    it('saves a workflow', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })
      await saveWorkflow('test.json', { '1': {} })
      expect(mockFetch.mock.calls[0][1].method).toBe('POST')
    })
  })

  describe('checkConnection', () => {
    it('returns true when server responds ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })
      expect(await checkConnection()).toBe(true)
    })

    it('returns false when server responds not ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })
      expect(await checkConnection()).toBe(false)
    })

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'))
      expect(await checkConnection()).toBe(false)
    })

    it('uses custom baseUrl', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })
      await checkConnection('http://custom:9000')
      expect(mockFetch.mock.calls[0][0]).toBe('http://custom:9000/system_stats')
    })
  })

  describe('connectWS', () => {
    it('returns a close controller', () => {
      const cb = vi.fn()
      const ws = connectWS('client1', cb)
      expect(typeof ws.close).toBe('function')
    })

    it('constructs correct WebSocket URL (http → ws)', () => {
      const cb = vi.fn()
      connectWS('client1', cb, 'http://localhost:8188')
    })

    it('calls close on the WebSocket when controller.close() is called', () => {
      const cb = vi.fn()
      const controller = connectWS('client1', cb)
      controller.close()
    })

    it('parses JSON messages and calls onMessage', () => {
      let wsInstance: MockWebSocket | undefined
      const origWS = globalThis.WebSocket
      ;(globalThis as any).WebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url)
          wsInstance = this
        }
      }
      ;((globalThis as any).WebSocket as any).OPEN = 1
      ;((globalThis as any).WebSocket as any).CONNECTING = 0

      const cb = vi.fn()
      connectWS('client1', cb, 'http://localhost:8188')

      // Simulate a JSON message
      wsInstance!.onmessage!({ data: JSON.stringify({ type: 'progress', data: { value: 50 } }) })
      expect(cb).toHaveBeenCalledWith({ type: 'progress', data: { value: 50 } })

      globalThis.WebSocket = origWS as any
    })

    it('ignores binary frames (non-JSON)', () => {
      let wsInstance: MockWebSocket | undefined
      const origWS = globalThis.WebSocket
      ;(globalThis as any).WebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url)
          wsInstance = this
        }
      }
      ;((globalThis as any).WebSocket as any).OPEN = 1
      ;((globalThis as any).WebSocket as any).CONNECTING = 0

      const cb = vi.fn()
      connectWS('client1', cb, 'http://localhost:8188')

      // Simulate a binary frame (non-parseable)
      wsInstance!.onmessage!({ data: new ArrayBuffer(8) })
      expect(cb).not.toHaveBeenCalled()

      globalThis.WebSocket = origWS as any
    })

    it('logs errors on ws.onerror', () => {
      let wsInstance: MockWebSocket | undefined
      const origWS = globalThis.WebSocket
      ;(globalThis as any).WebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url)
          wsInstance = this
        }
      }
      ;((globalThis as any).WebSocket as any).OPEN = 1
      ;((globalThis as any).WebSocket as any).CONNECTING = 0

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const cb = vi.fn()
      connectWS('client1', cb, 'http://localhost:8188')

      wsInstance!.onerror!({ type: 'error' })
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()

      globalThis.WebSocket = origWS as any
    })

    it('does not close if WebSocket is already closed', () => {
      let wsInstance: MockWebSocket | undefined
      const origWS = globalThis.WebSocket
      ;(globalThis as any).WebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url)
          wsInstance = this
          this.readyState = 3 // CLOSED
        }
      }
      ;((globalThis as any).WebSocket as any).OPEN = 1
      ;((globalThis as any).WebSocket as any).CONNECTING = 0

      const cb = vi.fn()
      const controller = connectWS('client1', cb, 'http://localhost:8188')
      controller.close()
      expect(wsInstance!.close).not.toHaveBeenCalled()

      globalThis.WebSocket = origWS as any
    })
  })
})
