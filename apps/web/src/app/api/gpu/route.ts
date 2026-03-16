import { NextResponse } from 'next/server'
import os from 'os'
import { detectGpus, clearGpuCache } from '@/lib/gpu-detect'

interface CpuInfo {
  model: string
  cores: number
  threads: number
  ramGB: number
}

function getCpuInfo(): CpuInfo {
  const cpus = os.cpus()
  const model = cpus[0]?.model?.trim() ?? 'Unknown CPU'
  // Physical cores: unique core ids aren't available in Node, so use cores count / 2 heuristic
  // os.cpus() returns logical threads
  const threads = cpus.length
  const cores = threads / 2 // most modern CPUs are hyperthreaded
  const ramGB = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10
  return { model, cores, threads, ramGB }
}

/**
 * GET /api/gpu
 * Returns cached detected GPUs + CPU info.
 */
export async function GET() {
  const gpus = detectGpus()
  const cpu = getCpuInfo()
  return NextResponse.json({ gpus, cpu })
}

/**
 * POST /api/gpu
 * Re-detects GPUs (clears cache) and returns the result + CPU info.
 */
export async function POST() {
  clearGpuCache()
  const gpus = detectGpus()
  const cpu = getCpuInfo()
  return NextResponse.json({ gpus, cpu })
}
