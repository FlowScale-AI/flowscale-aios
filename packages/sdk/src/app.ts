import { bridge } from './bridge';
import { AppInfo } from './types';

export const app = {
  /** Get information about the currently running app. */
  getInfo(): AppInfo | null {
    return bridge.app;
  },

  /** Check whether the bridge is ready (i.e., the runtime has bootstrapped this app). */
  isReady(): boolean {
    return bridge.ready;
  },

  /**
   * Wait until the bridge is ready, then call the callback.
   * If already ready, the callback is called synchronously on the next tick.
   */
  onReady(callback: (info: AppInfo) => void): void {
    if (bridge.ready && bridge.app) {
      Promise.resolve().then(() => callback(bridge.app!));
      return;
    }
    const unsubscribe = bridge.on('bridge:ready', (params) => {
      unsubscribe();
      callback(params as AppInfo);
    });
  },

  /** Signal to the host that this app has finished loading. */
  async signalReady(): Promise<void> {
    await bridge.call<void>('app.ready');
  },
};
