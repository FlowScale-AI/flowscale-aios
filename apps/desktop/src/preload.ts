import { contextBridge, ipcRenderer } from 'electron'
import type { FlowscaleTokens } from './config/store.js'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isDesktop: true,
  dialog: {
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  },
  watch: {
    start: (watchPath: string, cb: () => void): void => {
      ipcRenderer.invoke('watch:start', watchPath)
      ipcRenderer.on('app-dir-changed', (_event, changedPath: string) => {
        if (changedPath === watchPath) cb()
      })
    },
    stop: (watchPath: string): void => {
      ipcRenderer.invoke('watch:stop', watchPath)
    },
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
