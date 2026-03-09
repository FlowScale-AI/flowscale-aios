import { bridge } from './bridge';
import { ProviderName, ProviderStatus, ProviderRunOptions } from './types';

export const providers = {
  /** List configured cloud providers. */
  async list(): Promise<ProviderStatus[]> {
    return bridge.call<ProviderStatus[]>('providers.list');
  },

  /** Run inference via a cloud provider. */
  async run(
    provider: ProviderName,
    endpoint: string,
    payload: Record<string, unknown>,
    options: ProviderRunOptions = {},
  ): Promise<unknown> {
    const { timeout, onProgress } = options;

    let unsubscribe: (() => void) | undefined;
    if (onProgress) {
      unsubscribe = bridge.on(`providers.progress.${provider}`, (params) => {
        const p = params as { progress: number };
        onProgress(p.progress);
      });
    }

    try {
      return await bridge.call<unknown>(
        'providers.run',
        { provider, endpoint, payload },
        timeout,
      );
    } finally {
      unsubscribe?.();
    }
  },
};
