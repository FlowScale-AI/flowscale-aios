import { bridge } from './bridge';
import { ToolDefinition, ToolRunOptions, ToolRunResult } from './types';

export const tools = {
  /** List all tools available to this app. */
  async list(): Promise<ToolDefinition[]> {
    return bridge.call<ToolDefinition[]>('tools.list');
  },

  /** Get a single tool by ID. */
  async get(id: string): Promise<ToolDefinition> {
    return bridge.call<ToolDefinition>('tools.get', { id });
  },

  /** Run a tool and get back its outputs. */
  async run(
    id: string,
    inputs: Record<string, unknown>,
    options: ToolRunOptions = {},
  ): Promise<ToolRunResult> {
    const { timeout, onProgress } = options;

    let unsubscribe: (() => void) | undefined;
    if (onProgress) {
      unsubscribe = bridge.on(`tools.progress.${id}`, (params) => {
        const p = params as { progress: number; message?: string };
        onProgress(p.progress, p.message);
      });
    }

    try {
      return await bridge.call<ToolRunResult>('tools.run', { id, inputs }, timeout);
    } finally {
      unsubscribe?.();
    }
  },
};
