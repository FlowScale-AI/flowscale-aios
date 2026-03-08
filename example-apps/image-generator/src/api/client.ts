/**
 * Thin API client for the browser.
 *
 * All requests go to /api/* (same-origin in dev via Vite proxy → localhost:14173).
 * We do NOT use @flowscale/sdk's createClient() because browsers block manually
 * setting the Cookie header and cannot read Set-Cookie from fetch responses.
 * Instead, credentials: 'include' lets the browser send the fs_session cookie
 * automatically after login.
 */
import type { ToolDefinition, ToolRunResult, CurrentUser } from '../types'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: init?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const apiClient = {
  async login(username: string, password: string): Promise<CurrentUser> {
    return apiFetch<{ user: CurrentUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }).then((r) => r.user)
  },

  async me(): Promise<CurrentUser> {
    return apiFetch<CurrentUser>('/api/auth/me')
  },

  async logout(): Promise<void> {
    await apiFetch('/api/auth/logout', { method: 'POST' })
  },

  async listTools(): Promise<ToolDefinition[]> {
    return apiFetch<ToolDefinition[]>('/api/tools?status=production')
  },

  async getTool(id: string): Promise<ToolDefinition> {
    return apiFetch<ToolDefinition>(`/api/tools/${id}`)
  },

  async runTool(
    id: string,
    inputs: Record<string, unknown>,
    opts?: { signal?: AbortSignal; onProgress?: (status: string) => void },
  ): Promise<ToolRunResult> {
    opts?.onProgress?.('running')

    const execution = await apiFetch<{
      id: string
      toolId?: string
      status: string
      outputsJson?: string
      errorMessage?: string
      error?: string
      executionId?: string
    }>(`/api/tools/${id}/executions?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ inputs }),
      signal: opts?.signal,
    })

    if (execution.error) throw new Error(execution.error)

    // API-engine tools return 202 with status=running — poll until done
    if (execution.status === 'running' && execution.executionId) {
      const executionId = execution.executionId
      const deadline = Date.now() + 300_000

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000))
        const row = await apiFetch<{ status: string; outputsJson?: string; errorMessage?: string }>(
          `/api/executions/${executionId}`,
        )
        if (row.status === 'completed') {
          opts?.onProgress?.('completed')
          const outputs = JSON.parse(row.outputsJson ?? '[]')
          return { executionId, toolId: id, status: 'completed', outputs }
        }
        if (row.status === 'error') throw new Error(row.errorMessage ?? 'Execution failed')
        opts?.onProgress?.(row.status)
      }
      throw new Error('Execution timed out')
    }

    if (execution.status === 'error') throw new Error(execution.errorMessage ?? 'Execution failed')

    opts?.onProgress?.('completed')
    const outputs = JSON.parse(execution.outputsJson ?? '[]')
    return { executionId: execution.id, toolId: id, status: 'completed', outputs }
  },

  async uploadImage(comfyPort: number, file: File): Promise<string> {
    const form = new FormData()
    form.append('image', file)
    form.append('overwrite', 'true')

    const res = await fetch(`/api/comfy/${comfyPort}/upload/image`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`)
    const data = await res.json() as { name: string }
    return data.name
  },

  /** Resolve a relative output path to an absolute URL for the FlowScale instance. */
  resolveUrl(path: string, baseUrl: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    // In dev, we can use the relative path directly (served via Vite proxy)
    return path
  },
}
