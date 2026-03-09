/**
 * API client built on @flowscale/sdk (HTTP transport).
 *
 * Auth (login / me / logout) still uses fetch with credentials:'include'
 * because browsers block setting Cookie headers manually and cannot read
 * Set-Cookie from fetch responses.  The SDK's createClient() sets a Cookie
 * header which browsers silently drop, but the browser's own cookie jar
 * sends the real fs_session cookie automatically for same-origin requests.
 */
import { createClient } from '@flowscale/sdk'
import type { ToolDefinition, ToolRunResult, CurrentUser } from '../types'

// baseUrl: '' → relative URLs, proxied to localhost:14173 by Vite.
// sessionToken: placeholder; browser sends the real fs_session cookie automatically.
const sdkClient = createClient({ baseUrl: '', sessionToken: 'browser-session' })

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const apiClient = {
  // ─── Authentication (direct fetch — SDK has no auth helpers) ─────────
  async login(username: string, password: string): Promise<CurrentUser> {
    return authFetch<{ user: CurrentUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }).then((r) => r.user)
  },

  async me(): Promise<CurrentUser> {
    return authFetch<CurrentUser>('/api/auth/me')
  },

  async logout(): Promise<void> {
    await authFetch('/api/auth/logout', { method: 'POST' })
  },

  // ─── Tools (via @flowscale/sdk HTTP client) ──────────────────────────
  async listTools(): Promise<ToolDefinition[]> {
    return sdkClient.tools.list() as unknown as Promise<ToolDefinition[]>
  },

  async runTool(
    id: string,
    inputs: Record<string, unknown>,
    opts?: { onProgress?: (status: string) => void },
  ): Promise<ToolRunResult> {
    return sdkClient.tools.run(id, inputs, { onProgress: opts?.onProgress }) as Promise<ToolRunResult>
  },

  // ─── Image upload (SDK has no upload helper) ─────────────────────────
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
}
