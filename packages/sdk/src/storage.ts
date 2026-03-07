import { bridge } from './bridge';
import { StorageScope } from './types';

export const storage = {
  /** Get a value by key. Returns undefined if not set. */
  async get<T = unknown>(key: string, scope: StorageScope = 'app'): Promise<T | undefined> {
    return bridge.call<T | undefined>('storage.get', { key, scope });
  },

  /** Set a value. Overwrites any existing value at that key. */
  async set(key: string, value: unknown, scope: StorageScope = 'app'): Promise<void> {
    await bridge.call<void>('storage.set', { key, value, scope });
  },

  /** Delete a value by key. No-op if the key does not exist. */
  async delete(key: string, scope: StorageScope = 'app'): Promise<void> {
    await bridge.call<void>('storage.delete', { key, scope });
  },

  /** List all keys visible to this app in the given scope. */
  async keys(scope: StorageScope = 'app'): Promise<string[]> {
    return bridge.call<string[]>('storage.keys', { scope });
  },
};
