// ─── JSON-RPC 2.0 envelope types ─────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse;

// ─── SDK error codes ──────────────────────────────────────────────────────────

export const SDK_ERROR = {
  BRIDGE_NOT_READY: -32000,
  TIMEOUT: -32001,
  PERMISSION_DENIED: -32003,
  NOT_FOUND: -32004,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

// ─── Tool types ───────────────────────────────────────────────────────────────

export interface ToolInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'image' | 'select';
  label?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface ToolOutput {
  name: string;
  type: 'string' | 'number' | 'image' | 'json';
  label?: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description?: string;
  inputs: ToolInput[];
  outputs: ToolOutput[];
  category?: string;
  version?: string;
}

export interface ToolRunOptions {
  timeout?: number;
  onProgress?: (progress: number, message?: string) => void;
}

export interface ToolRunResult {
  outputs: Record<string, unknown>;
  executionId?: string;
}

// ─── Provider types ───────────────────────────────────────────────────────────

export type ProviderName = 'fal' | 'replicate' | 'openrouter' | 'huggingface';

export interface ProviderStatus {
  name: ProviderName;
  configured: boolean;
}

export interface ProviderRunOptions {
  timeout?: number;
  onProgress?: (progress: number) => void;
}

// ─── Storage types ────────────────────────────────────────────────────────────

export type StorageScope = 'app' | 'user';

// ─── UI types ─────────────────────────────────────────────────────────────────

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

export interface DialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

// ─── App / manifest types ─────────────────────────────────────────────────────

export type Permission =
  | 'tools:read'
  | 'tools:run'
  | 'providers:use'
  | 'storage:read'
  | 'storage:write'
  | 'ui:toast'
  | 'ui:dialog';

export interface AppInfo {
  id: string;
  name: string;
  version: string;
  permissions: Permission[];
}

export interface BridgeReadyEvent {
  type: 'bridge:ready';
  app: AppInfo;
}
