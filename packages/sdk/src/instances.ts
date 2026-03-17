import { bridge } from './bridge';
import { InstanceInfo } from './types';

export const instances = {
  /**
   * List all configured ComfyUI instances with their current status.
   * Requires `tools` permission.
   */
  async list(): Promise<InstanceInfo[]> {
    return bridge.call<InstanceInfo[]>('instances.list');
  },
};
