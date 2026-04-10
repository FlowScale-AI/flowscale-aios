import { NextResponse } from 'next/server'
import os from 'os'
import { detectGpus, clearGpuCache } from '@/lib/gpu-detect'

/**
 * POST /api/setup/gpu
 * Re-detects GPUs (clears cache) and returns the result + CPU info.
 * No auth required — only used during first-run setup.
 */
export async function POST() {
  clearGpuCache()
  const gpus = detectGpus()

  const cpus = os.cpus()
  const model = cpus[0]?.model?.trim() ?? 'Unknown CPU'
  const threads = cpus.length
  const cores = Math.ceil(threads / 2)
  const ramGB = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10

  return NextResponse.json({ gpus, cpu: { model, cores, threads, ramGB } })
}
