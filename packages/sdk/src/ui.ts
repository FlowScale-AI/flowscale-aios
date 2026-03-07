import { bridge } from './bridge';
import { ToastOptions, DialogOptions } from './types';

export const ui = {
  /** Show a toast notification in the host UI. */
  async toast(options: ToastOptions): Promise<void> {
    await bridge.call<void>('ui.toast', options);
  },

  /** Show a confirmation dialog. Resolves to true if the user confirms. */
  async confirm(options: DialogOptions): Promise<boolean> {
    return bridge.call<boolean>('ui.confirm', options);
  },

  /** Request the host to resize the app container (in pixels). */
  async resize(width: number | null, height: number | null): Promise<void> {
    await bridge.call<void>('ui.resize', { width, height });
  },
};
