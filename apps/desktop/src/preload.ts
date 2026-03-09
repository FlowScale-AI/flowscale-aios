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
  report: {
    getSystemInfo: (): Promise<{ version: string; platform: string; logs: string }> =>
      ipcRenderer.invoke('report:getSystemInfo'),
  },
  updates: {
    onAvailable: (callback: (info: { version: string }) => void): (() => void) => {
      const handler = (_: unknown, info: { version: string }): void => callback(info)
      ipcRenderer.on('updates:available', handler)
      return (): void => { ipcRenderer.removeListener('updates:available', handler) }
    },
    onNotAvailable: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('updates:not-available', handler)
      return (): void => { ipcRenderer.removeListener('updates:not-available', handler) }
    },
    onProgress: (callback: (p: { percent: number }) => void): (() => void) => {
      const handler = (_: unknown, p: { percent: number }): void => callback(p)
      ipcRenderer.on('updates:progress', handler)
      return (): void => { ipcRenderer.removeListener('updates:progress', handler) }
    },
    onDownloaded: (callback: (info: { version: string }) => void): (() => void) => {
      const handler = (_: unknown, info: { version: string }): void => callback(info)
      ipcRenderer.on('updates:downloaded', handler)
      return (): void => { ipcRenderer.removeListener('updates:downloaded', handler) }
    },
    onError: (callback: (err: { message: string }) => void): (() => void) => {
      const handler = (_: unknown, err: { message: string }): void => callback(err)
      ipcRenderer.on('updates:error', handler)
      return (): void => { ipcRenderer.removeListener('updates:error', handler) }
    },
    check: (): Promise<void> => ipcRenderer.invoke('updates:check'),
    download: (): Promise<void> => ipcRenderer.invoke('updates:download'),
    install: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  },
})
