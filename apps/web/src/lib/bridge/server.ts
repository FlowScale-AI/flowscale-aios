import type { AppManifest, Permission } from '@/lib/appManifest'

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface BridgeServerOptions {
  appId: string
  manifest: AppManifest
  userId: string | null
  /** Called to send a message back to the iframe */
  send: (msg: JsonRpcResponse | { jsonrpc: '2.0'; method: string; params: unknown }) => void
  /** Called when bridge requests a confirm dialog */
  onConfirm?: (title: string, message?: string) => Promise<boolean>
  /** Called when bridge requests a toast */
  onToast?: (type: string, message: string) => void
}

export class BridgeServer {
  private _opts: BridgeServerOptions

  constructor(opts: BridgeServerOptions) {
    this._opts = opts
  }

  async dispatch(msg: JsonRpcRequest): Promise<void> {
    const { id, method, params } = msg
    try {
      const result = await this._route(method, params)
      this._respond(id, result)
    } catch (err) {
      const e = err as { code?: number; message?: string }
      this._error(id, e.code ?? -32603, e.message ?? 'Internal error')
    }
  }

  notify(method: string, params: unknown): void {
    this._opts.send({ jsonrpc: '2.0', method, params })
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  private async _route(method: string, params: unknown): Promise<unknown> {
    const p = params as Record<string, unknown> | undefined

    switch (method) {
      // ── app ──────────────────────────────────────────────────────────────
      case 'app.ready':
        return null

      case 'app.getContext':
        return {
          appId: this._opts.appId,
          userId: this._opts.userId,
          permissions: this._opts.manifest.permissions,
        }

      // ── tools ─────────────────────────────────────────────────────────────
      case 'tools.list': {
        const res = await fetch('/api/tools?status=production')
        return res.json()
      }

      case 'tools.registry': {
        const res = await fetch('/api/tools/registry')
        return res.json()
      }

      case 'tools.get': {
        const { id } = p as { id: string }
        const res = await fetch(`/api/tools/${id}`)
        if (!res.ok) this._throw(404, `Tool not found: ${id}`)
        return res.json()
      }

      case 'tools.run': {
        this._require('tools')
        const res = await fetch('/api/bridge/tools/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: this._opts.appId, ...p }),
        })
        if (!res.ok) {
          const err = await res.json() as { error?: string }
          this._throw(res.status, err.error ?? 'Tool run failed')
        }
        return res.json()
      }

      // ── providers ────────────────────────────────────────────────────────
      case 'providers.list': {
        const res = await fetch('/api/providers')
        return res.json()
      }

      case 'providers.run': {
        const { provider, endpoint, payload } = p as {
          provider: string
          endpoint: string
          payload: Record<string, unknown>
        }
        this._require(`providers:${provider}` as Permission)
        const res = await fetch(`/api/providers/${provider}/proxy/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json() as { error?: string }
          this._throw(res.status, err.error ?? 'Provider error')
        }
        return res.json()
      }

      // ── storage ───────────────────────────────────────────────────────────
      case 'storage.get':
      case 'storage.set':
      case 'storage.delete':
      case 'storage.keys': {
        this._require('storage:readwrite')
        const action = method.split('.')[1]
        const res = await fetch('/api/bridge/storage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: this._opts.appId, action, ...p }),
        })
        return res.json()
      }

      // ── ui ────────────────────────────────────────────────────────────────
      case 'ui.toast': {
        const { title, variant } = p as { title: string; variant?: string }
        this._opts.onToast?.(variant ?? 'info', title)
        return null
      }

      case 'ui.confirm': {
        const { title, description } = p as { title: string; description?: string }
        const confirmed = await (this._opts.onConfirm?.(title, description) ?? Promise.resolve(false))
        return confirmed
      }

      case 'ui.resize':
        // Handled by AppFrame directly; bridge just acknowledges
        return null

      // ── storage.files ─────────────────────────────────────────────────────
      case 'storage.files.write': {
        this._require('storage:files')
        const { key: filePath, value: data } = p as { key: string; value: string }
        const res = await fetch('/api/bridge/storage/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: this._opts.appId, path: filePath, data }),
        })
        return res.json()
      }

      case 'storage.files.read': {
        this._require('storage:files')
        const { key: filePath } = p as { key: string }
        const url = `/api/bridge/storage/files?appId=${encodeURIComponent(this._opts.appId)}&path=${encodeURIComponent(filePath)}`
        const res = await fetch(url)
        if (!res.ok) this._throw(404, 'File not found')
        const buf = await res.arrayBuffer()
        return Buffer.from(buf).toString('base64')
      }

      case 'storage.files.delete': {
        this._require('storage:files')
        const { key: filePath } = p as { key: string }
        const res = await fetch('/api/bridge/storage/files', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: this._opts.appId, path: filePath }),
        })
        return res.json()
      }

      case 'storage.files.list': {
        this._require('storage:files')
        const { dir } = (p ?? {}) as { dir?: string }
        const url = `/api/bridge/storage/files?appId=${encodeURIComponent(this._opts.appId)}${dir ? `&dir=${encodeURIComponent(dir)}` : ''}`
        const res = await fetch(url)
        return res.json()
      }

      default:
        this._throw(-32601, `Method not found: ${method}`)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _require(permission: Permission): void {
    if (!this._opts.manifest.permissions.includes(permission)) {
      this._throw(-32003, `Permission denied: ${permission}`)
    }
  }

  private _respond(id: string | number, result: unknown): void {
    this._opts.send({ jsonrpc: '2.0', id, result })
  }

  private _error(id: string | number, code: number, message: string): void {
    this._opts.send({ jsonrpc: '2.0', id, error: { code, message } })
  }

  private _throw(code: number, message: string): never {
    throw { code, message }
  }
}
