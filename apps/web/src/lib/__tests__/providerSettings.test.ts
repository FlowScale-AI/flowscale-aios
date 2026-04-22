import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// We need to control the settings file path — mock os.homedir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-test-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => tmpDir }
})

// Re-import after mock
const { getCustomScripts, setCustomScripts, getComfyInstances, setComfyInstances } =
  await import('../providerSettings')

describe('customScripts', () => {
  beforeEach(() => {
    // Clear settings file before each test
    const settingsDir = path.join(tmpDir, '.flowscale', 'aios')
    fs.rmSync(settingsDir, { recursive: true, force: true })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns empty array when no scripts saved', () => {
    expect(getCustomScripts()).toEqual([])
  })

  it('round-trips a script array', () => {
    const scripts = [
      { id: 'abc', label: 'RTX 4060 Ti', path: 'C:/ComfyUI/run.bat' },
    ]
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
  beforeEach(() => {
    const settingsDir = path.join(tmpDir, '.flowscale', 'aios')
    fs.rmSync(settingsDir, { recursive: true, force: true })
  })

  it('persists and retrieves launchScriptId on an instance', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0', launchScriptId: 'abc' },
    ])
    const instances = getComfyInstances()
    expect(instances[0].launchScriptId).toBe('abc')
  })

  it('allows launchScriptId to be absent', () => {
    setComfyInstances([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0' },
    ])
    expect(getComfyInstances()[0].launchScriptId).toBeUndefined()
  })
})
