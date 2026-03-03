import { contextBridge, ipcRenderer } from 'electron'
import type { FlowscaleTokens } from './config/store.js'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isDesktop: true,
  dialog: {
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  },
  auth: {
    startFlowscaleOAuth: (): Promise<void> =>
      ipcRenderer.invoke('auth:startFlowscaleOAuth'),
    getFlowscaleTokens: (): Promise<FlowscaleTokens> =>
      ipcRenderer.invoke('auth:getFlowscaleTokens'),
    clearFlowscaleTokens: (): Promise<void> =>
      ipcRenderer.invoke('auth:clearFlowscaleTokens'),
    onComplete: (callback: (tokens: FlowscaleTokens) => void): (() => void) => {
      const handler = (_: unknown, tokens: FlowscaleTokens): void => callback(tokens)
      ipcRenderer.on('auth:complete', handler)
      return (): void => {
        ipcRenderer.removeListener('auth:complete', handler)
      }
    },
  },
})
