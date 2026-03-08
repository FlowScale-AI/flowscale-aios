import { useState, useEffect } from 'react'
import { apiClient } from '../api/client'
import type { ToolDefinition } from '../types'

export function useTools() {
  const [tools, setTools] = useState<ToolDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    apiClient.listTools()
      .then(setTools)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return { tools, loading, error }
}
