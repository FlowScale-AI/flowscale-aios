import { bridge } from './bridge';
import { ToolDefinition, ToolOutputItem, ToolRunOptions, ToolRunResult, OutputRef } from './types';

export const tools = {
  /**
   * Create an output reference for chaining one tool's output into another's input.
   * Pass the returned value as an image input to the next tools.run() call.
   * The bridge handles the ComfyUI output→input transfer server-side.
   */
  outputRef(output: ToolOutputItem): OutputRef {
    return { __comfy_output__: { filename: output.filename, subfolder: output.subfolder } };
  },

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
    const { timeout, onProgress, comfyPort } = options;

    let unsubscribe: (() => void) | undefined;
    if (onProgress) {
      unsubscribe = bridge.on(`tools.progress.${id}`, (params) => {
        const p = params as { progress: number; message?: string };
        onProgress(p.progress, p.message);
      });
    }

    try {
      return await bridge.call<ToolRunResult>(
        'tools.run',
        { id, inputs, ...(comfyPort != null ? { comfyPort } : {}) },
        timeout,
      );
    } finally {
      unsubscribe?.();
    }
  },
};
