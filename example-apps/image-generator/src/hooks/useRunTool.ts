import { useState, useRef } from 'react'
import { apiClient } from '../api/client'
import type { ToolRunResult } from '../types'

type RunStatus = 'idle' | 'running' | 'completed' | 'error'

export function useRunTool() {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [result, setResult] = useState<ToolRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function run(toolId: string, inputs: Record<string, unknown>) {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('running')
    setResult(null)
    setError(null)

    try {
      const res = await apiClient.runTool(toolId, inputs, {
        signal: ctrl.signal,
        onProgress: (s) => {
          if (s === 'completed') setStatus('completed')
        },
      })
      setResult(res)
      setStatus('completed')
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus('idle')
      } else {
        setError((err as Error).message)
        setStatus('error')
      }
    }
  }

  function cancel() {
    abortRef.current?.abort()
  }

  function reset() {
    abortRef.current?.abort()
    setStatus('idle')
    setResult(null)
    setError(null)
  }

  return { run, cancel, reset, status, result, error }
}
