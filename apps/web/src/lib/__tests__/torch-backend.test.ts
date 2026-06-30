import { describe, expect, it, vi, beforeEach } from 'vitest'
const execSync = vi.fn()
const existsSync = vi.fn(() => false)
vi.mock('child_process', () => ({ execSync: (...a: unknown[]) => execSync(...a) }))
vi.mock('fs', () => ({ existsSync: (p: string) => existsSync(p) }))
import { detectTorchBackend, torchIndexUrl } from '../torch-backend'
beforeEach(() => { execSync.mockReset(); existsSync.mockReset(); existsSync.mockReturnValue(false) })
describe('torch-backend', () => {
  it('rocm when /dev/kfd exists, even if nvidia-smi would succeed (ROCm wins)', () => {
    existsSync.mockReturnValue(true); execSync.mockReturnValue('')
    expect(detectTorchBackend()).toBe('rocm')
  })
  it('cuda when no kfd but nvidia-smi works', () => {
    existsSync.mockReturnValue(false); execSync.mockReturnValue('')
    expect(detectTorchBackend()).toBe('cuda')
  })
  it('cpu when neither kfd nor nvidia', () => {
    existsSync.mockReturnValue(false); execSync.mockImplementation(() => { throw new Error('not found') })
    expect(detectTorchBackend()).toBe('cpu')
  })
  it('torchIndexUrl maps each backend', () => {
    expect(torchIndexUrl('rocm')).toBe('https://download.pytorch.org/whl/rocm6.3')
    expect(torchIndexUrl('cuda')).toBe('https://download.pytorch.org/whl/cu124')
    expect(torchIndexUrl('cpu')).toBe('https://download.pytorch.org/whl/cpu')
  })
})
