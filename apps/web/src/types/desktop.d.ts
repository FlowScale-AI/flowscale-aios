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
  }
  shell: {
    openExternal(url: string): Promise<void>
  }
  auth: {
    startFlowscaleOAuth(): Promise<void>
    getFlowscaleTokens(): Promise<FlowscaleTokens>
    clearFlowscaleTokens(): Promise<void>
    onComplete(callback: (tokens: FlowscaleTokens) => void): () => void
  }
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}
