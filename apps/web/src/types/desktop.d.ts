export {}

interface FlowscaleTokens {
  accessToken: string | null
  refreshToken: string | null
  username: string | null
  teamId: string | null
  teamName: string | null
}

interface DesktopBridge {
  isDesktop: true
  platform: string
  dialog: {
    openFile(): Promise<string | null>
    openDirectory?(): Promise<string | null>
  }
  shell: {
    openExternal(url: string): Promise<void>
  }
  watch?: {
    start(path: string, cb: () => void): void
    stop(path: string): void
  }
  auth: {
    startFlowscaleOAuth(): Promise<void>
    getFlowscaleTokens(): Promise<FlowscaleTokens>
    clearFlowscaleTokens(): Promise<void>
    onComplete(callback: (tokens: FlowscaleTokens) => void): () => void
  }
  updates?: {
    onAvailable(callback: (info: { version: string }) => void): () => void
    onNotAvailable(callback: () => void): () => void
    onProgress(callback: (p: { percent: number }) => void): () => void
    onDownloaded(callback: (info: { version: string }) => void): () => void
    onError(callback: (err: { message: string }) => void): () => void
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
  }
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}
