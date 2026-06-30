import { execSync } from 'child_process'
import { existsSync } from 'fs'

export type TorchBackend = 'rocm' | 'cuda' | 'cpu'

/** Detect the torch backend. ROCm (/dev/kfd) wins over CUDA on the rare dual-present host. */
export function detectTorchBackend(): TorchBackend {
  try { if (existsSync('/dev/kfd')) return 'rocm' } catch { /* ignore */ }
  try { execSync('nvidia-smi -L', { stdio: 'ignore', timeout: 5000 }); return 'cuda' } catch { /* no nvidia */ }
  return 'cpu'
}

export function torchIndexUrl(backend: TorchBackend): string {
  return backend === 'rocm' ? 'https://download.pytorch.org/whl/rocm6.3'
    : backend === 'cuda' ? 'https://download.pytorch.org/whl/cu124'
    : 'https://download.pytorch.org/whl/cpu'
}
