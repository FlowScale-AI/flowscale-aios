import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Save and reset the real settings file so tests are isolated without modifying production code
const settingsDir = join(homedir(), '.flowscale', 'aios')
const settingsFile = join(settingsDir, 'settings.json')
let savedContent: string | undefined

beforeAll(() => {
  mkdirSync(settingsDir, { recursive: true })
  savedContent = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf-8') : undefined
})

beforeEach(() => {
  writeFileSync(settingsFile, '{}')
})

afterAll(() => {
  if (savedContent !== undefined) {
    writeFileSync(settingsFile, savedContent)
  }
})

const {
  getCustomScripts,
  setCustomScripts,
  getComfyInstances,
  setComfyInstances,
  getComfyManagedPath,
  setComfyManagedPath,
  setComfyUIPath,
} = await import('../providerSettings')

describe('customScripts', () => {
  it('returns empty array when no scripts saved', () => {
    expect(getCustomScripts()).toEqual([])
  })

  it('round-trips a script array', () => {
    const scripts = [{ id: 'abc', label: 'RTX 4060 Ti', path: 'C:/ComfyUI/run.bat' }]
    setCustomScripts(scripts)
    expect(getCustomScripts()).toEqual(scripts)
  })

  it('overwrites previous scripts on set', () => {
    setCustomScripts([{ id: 'a', label: 'A', path: '/a.sh' }])
    setCustomScripts([{ id: 'b', label: 'B', path: '/b.sh' }])
    expect(getCustomScripts()).toEqual([{ id: 'b', label: 'B', path: '/b.sh' }])
  })
})

describe('ComfyInstanceConfig.launchScriptId', () => {
  it('persists and retrieves launchScriptId on an instance', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0', launchScriptId: 'abc' },
    ])
    expect(getComfyInstances()[0].launchScriptId).toBe('abc')
  })

  it('allows launchScriptId to be absent', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0' },
    ])
    expect(getComfyInstances()[0].launchScriptId).toBeUndefined()
  })
})

describe('ComfyInstanceConfig.gpuName and customLabel', () => {
  it('persists and retrieves gpuName', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0 — RTX 4090', gpuName: 'RTX 4090' },
    ])
    expect(getComfyInstances()[0].gpuName).toBe('RTX 4090')
  })

  it('persists and retrieves customLabel', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0 — RTX 4090', customLabel: 'Image Gen' },
    ])
    expect(getComfyInstances()[0].customLabel).toBe('Image Gen')
  })

  it('allows gpuName and customLabel to be absent', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0 — RTX 4090' },
    ])
    const inst = getComfyInstances()[0]
    expect(inst.gpuName).toBeUndefined()
    expect(inst.customLabel).toBeUndefined()
  })

  it('clears customLabel when set to empty string and re-read', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0', customLabel: '' },
    ])
    // empty string should survive the round-trip (filtering is at display layer)
    expect(getComfyInstances()[0].customLabel).toBe('')
  })
})

describe('getComfyInstances — validation filter', () => {
  // Note: when ALL instances are invalid, getComfyInstances falls back to a
  // legacy synthetic CPU instance — so we test filtering by mixing valid with
  // invalid entries and asserting only valid ones survive.

  it('excludes instance where gpuName is a number', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0' },
      { id: 'gpu-1', port: 41189, device: 'cuda:1', label: 'GPU 1', gpuName: 42 } as never,
    ])
    const result = getComfyInstances()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('gpu-0')
  })

  it('excludes instance where customLabel is a number', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0' },
      { id: 'gpu-1', port: 41189, device: 'cuda:1', label: 'GPU 1', customLabel: 99 } as never,
    ])
    const result = getComfyInstances()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('gpu-0')
  })

  it('excludes instance where port is out of valid range', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0' },
      { id: 'bad', port: 80, device: 'cuda:1', label: 'Bad port' },
    ])
    const result = getComfyInstances()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('gpu-0')
  })

  it('excludes instance missing required id field', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0' },
      { port: 41189, device: 'cuda:1', label: 'No id' } as never,
    ])
    const result = getComfyInstances()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('gpu-0')
  })

  it('keeps all valid instances in a mixed array', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0' },
      { id: 'gpu-1', port: 41189, device: 'cuda:1', label: 'GPU 1', gpuName: 'RTX 4090' },
      { id: 'bad', port: 80, device: 'cuda:2', label: 'Bad' },
    ])
    const result = getComfyInstances()
    expect(result).toHaveLength(2)
    expect(result.map(r => r.id)).toEqual(['gpu-0', 'gpu-1'])
  })
})

describe('comfy managed path / UI path interaction', () => {
  it('setComfyManagedPath updates both keys so getComfyManagedPath sees the new value', () => {
    setComfyManagedPath('/new/path/ComfyUI')
    expect(getComfyManagedPath()).toBe('/new/path/ComfyUI')
  })

  it('REGRESSION: setComfyUIPath alone does NOT override stale comfyManagedPath', () => {
    // The bug from the field: Edit Configuration UI was wired to setComfyUIPath
    // (legacy key only). With a stale comfyManagedPath set by a previous failed
    // install, the spawn read the OLD path even after the user "saved" a new one.
    setComfyManagedPath('/stale/.flowscale/comfyui')
    setComfyUIPath('/new/desktop-app/ComfyUI')
    // The bug: spawns use getComfyManagedPath which prefers comfyManagedPath,
    // so it returns the stale value.
    expect(getComfyManagedPath()).toBe('/stale/.flowscale/comfyui')
  })

  it('FIX: setComfyManagedPath after a stale value overrides for spawns', () => {
    // After the route fix, the UI calls setComfyManagedPath which writes both
    // keys, so spawns see the saved value.
    setComfyManagedPath('/stale/.flowscale/comfyui')
    setComfyManagedPath('/new/desktop-app/ComfyUI')
    expect(getComfyManagedPath()).toBe('/new/desktop-app/ComfyUI')
  })

  it('falls back to legacy comfyuiPath when comfyManagedPath is unset', () => {
    setComfyUIPath('/legacy/only/path')
    expect(getComfyManagedPath()).toBe('/legacy/only/path')
  })
})
