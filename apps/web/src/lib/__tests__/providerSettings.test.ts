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

const { getCustomScripts, setCustomScripts, getComfyInstances, setComfyInstances } =
  await import('../providerSettings')

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
