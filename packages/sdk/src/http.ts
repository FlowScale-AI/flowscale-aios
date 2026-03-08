/**
 * HTTP transport for the FlowScale SDK.
 *
 * Use this when building apps that run **outside** FlowScale (e.g. a standalone
 * web app, a Node.js script, or a CLI tool). It talks to a running FlowScale
 * AIOS instance via its REST API instead of the iframe postMessage bridge.
 *
 * @example
 * ```ts
 * import { createClient } from '@flowscale/sdk/http'
 *
 * const client = createClient({
 *   baseUrl: 'http://localhost:14173',
 *   sessionToken: '<your-fs_session-cookie>',  // POST /api/auth/login to obtain one
 * })
 *
 * const result = await client.tools.run('sdxl-txt2img', {
 *   '6.text': 'a cat on the moon',
 * })
 * console.log(result.outputs) // [{ kind, filename, path }]
 *
 * // Prepend baseUrl to relative paths for direct access:
 * const imageUrl = client.resolveUrl(result.outputs[0].path)
 * ```
 */

import type { ToolDefinition, ToolRunResult, ToolOutputItem } from './types';

export interface HttpClientOptions {
  /**
   * Base URL of your FlowScale AIOS instance.
   * @example 'http://localhost:14173'
   */
  baseUrl: string;
  /**
   * Session token obtained from `POST /api/auth/login`.
   * Sent as the `fs_session` cookie on every request.
   */
  sessionToken: string;
  /**
   * How long (ms) to wait for a tool execution to complete before timing out.
   * @default 300_000 (5 minutes)
   */
  timeout?: number;
  /**
   * How often (ms) to poll for execution status.
   * @default 2_000
   */
  pollInterval?: number;
}

export interface LoginOptions {
  baseUrl: string;
  username: string;
  password: string;
}

/** Log in and return a session token without creating a full client. */
export async function login(opts: LoginOptions): Promise<string> {
  const res = await fetch(`${opts.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: opts.username, password: opts.password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `Login failed: HTTP ${res.status}`);
  }
  // Session token comes back as a Set-Cookie header (fs_session=<token>)
  const cookie = res.headers.get('set-cookie') ?? '';
  const match = cookie.match(/fs_session=([^;]+)/);
  if (!match) throw new Error('No session token in login response');
  return match[1];
}

export interface HttpClient {
  /** Resolve a relative output path (e.g. `/api/outputs/...`) to a full URL. */
  resolveUrl(path: string): string;
  tools: {
    /** List all production tools. */
    list(): Promise<ToolDefinition[]>;
    /** Get a single tool by ID. */
    get(id: string): Promise<ToolDefinition>;
    /**
     * Run a tool and wait for it to complete.
     *
     * For ComfyUI tools, inputs use `"${nodeId}__${paramName}"` keys.
     * For registry tools, inputs use `"${nodeId}.${paramName}"` keys.
     * Image inputs can be passed as base64 data URLs (`data:image/png;base64,...`).
     */
    run(
      id: string,
      inputs: Record<string, unknown>,
      options?: { timeout?: number; onProgress?: (status: string) => void },
    ): Promise<ToolRunResult>;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Create an HTTP client connected to a FlowScale AIOS instance. */
export function createClient(options: HttpClientOptions): HttpClient {
  const {
    baseUrl,
    sessionToken,
    timeout: defaultTimeout = 300_000,
    pollInterval = 2_000,
  } = options;

  async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `fs_session=${sessionToken}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status} ${path}`);
    }
    return res.json() as Promise<T>;
  }

  function resolveUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${baseUrl}${path}`;
  }

  const tools = {
    async list(): Promise<ToolDefinition[]> {
      return apiFetch<ToolDefinition[]>('/api/tools?status=production');
    },

    async get(id: string): Promise<ToolDefinition> {
      return apiFetch<ToolDefinition>(`/api/tools/${id}`);
    },

    async run(
      id: string,
      inputs: Record<string, unknown>,
      runOptions: { timeout?: number; onProgress?: (status: string) => void } = {},
    ): Promise<ToolRunResult> {
      const { timeout = defaultTimeout, onProgress } = runOptions;

      onProgress?.('running');

      // ?wait=true — server polls ComfyUI internally and returns only when done.
      // For API-engine tools the server also runs to completion before responding.
      // Either way we get back a finished execution row directly.
      const execution = await apiFetch<{
        id: string;
        toolId: string;
        status: string;
        outputsJson?: string;
        errorMessage?: string;
        error?: string;
        // API-engine tools return 202 with status='running' — fall through to poll
        executionId?: string;
      }>(`/api/tools/${id}/executions?wait=true`, {
        method: 'POST',
        body: JSON.stringify({ inputs }),
        signal: AbortSignal.timeout(timeout),
      });

      if (execution.error) throw new Error(execution.error);

      // API-engine tools still return 202 immediately — poll the execution record
      if (execution.status === 'running' && execution.executionId) {
        const executionId = execution.executionId;
        const deadline = Date.now() + timeout;

        while (Date.now() < deadline) {
          await sleep(pollInterval);
          const row = await apiFetch<{
            status: string;
            outputsJson?: string;
            errorMessage?: string;
          }>(`/api/executions/${executionId}`);

          if (row.status === 'completed') {
            onProgress?.('completed');
            let outputs: ToolOutputItem[] = [];
            try { outputs = JSON.parse(row.outputsJson ?? '[]') as ToolOutputItem[]; } catch { /* empty */ }
            return { executionId, toolId: id, status: 'completed', outputs };
          }
          if (row.status === 'error') throw new Error(row.errorMessage ?? 'Execution failed');
          onProgress?.(row.status);
        }
        throw new Error(`Execution timed out after ${timeout / 1000}s`);
      }

      if (execution.status === 'error') throw new Error(execution.errorMessage ?? 'Execution failed');

      onProgress?.('completed');
      let outputs: ToolOutputItem[] = [];
      try { outputs = JSON.parse(execution.outputsJson ?? '[]') as ToolOutputItem[]; } catch { /* empty */ }
      return {
        executionId: execution.id,
        toolId: id,
        status: 'completed',
        outputs,
      };
    },
  };

  return { resolveUrl, tools };
}
