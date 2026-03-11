import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcMessage,
  SDK_ERROR,
  AppInfo,
} from './types';

const DEFAULT_TIMEOUT = 30_000;

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Bridge {
  private _pending = new Map<string | number, PendingCall>();
  private _nextId = 1;
  private _ready = false;
  private _app: AppInfo | null = null;
  private _listeners = new Map<string, Set<(params: unknown) => void>>();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this._handleMessage.bind(this));
    }
  }

  get ready(): boolean {
    return this._ready;
  }

  get app(): AppInfo | null {
    return this._app;
  }

  /** Called by the runtime when the iframe is bootstrapped. */
  _bootstrap(app: AppInfo): void {
    this._app = app;
    this._ready = true;
  }

  /** Send a JSON-RPC call to the host runtime and await the response. */
  call<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT): Promise<T> {
    if (!this._ready) {
      return Promise.reject(this._rpcError(SDK_ERROR.BRIDGE_NOT_READY, 'Bridge not ready'));
    }
    return new Promise<T>((resolve, reject) => {
      const id = this._nextId++;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(this._rpcError(SDK_ERROR.TIMEOUT, `RPC timeout: ${method}`));
      }, timeoutMs);

      this._pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      window.parent.postMessage(msg, '*');
    });
  }

  /** Subscribe to push events from the host. */
  on(event: string, handler: (params: unknown) => void): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(handler);
    return () => this._listeners.get(event)?.delete(handler);
  }

  private _handleMessage(event: MessageEvent): void {
    const data = event.data as JsonRpcMessage;
    if (!data || data.jsonrpc !== '2.0') return;

    // Push notification (no id)
    if (!('id' in data) || data.id === undefined) {
      const req = data as JsonRpcRequest;
      const handlers = this._listeners.get(req.method);
      if (handlers) {
        handlers.forEach((h) => h(req.params));
      }
      return;
    }

    const res = data as JsonRpcResponse;
    const pending = this._pending.get(res.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this._pending.delete(res.id);

    if (res.error) {
      pending.reject(res.error);
    } else {
      pending.resolve(res.result);
    }
  }

  private _rpcError(code: number, message: string): { code: number; message: string } {
    return { code, message };
  }
}

/** Singleton bridge instance used by all SDK modules. */
export const bridge = new Bridge();
