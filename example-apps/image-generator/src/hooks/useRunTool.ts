import { useState } from 'react'
import { apiClient } from '../api/client'
import type { ToolRunResult } from '../types'

type RunStatus = 'idle' | 'running' | 'completed' | 'error'

export function useRunTool() {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [result, setResult] = useState<ToolRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(toolId: string, inputs: Record<string, unknown>) {
    setStatus('running')
    setResult(null)
    setError(null)

    try {
      const res = await apiClient.runTool(toolId, inputs, {
        onProgress: (s) => {
          if (s === 'completed') setStatus('completed')
        },
      })
      setResult(res)
      setStatus('completed')
    } catch (err) {
      setError((err as Error).message)
      setStatus('error')
    }
  }

  function reset() {
    setStatus('idle')
    setResult(null)
    setError(null)
  }

  return { run, reset, status, result, error }
}
