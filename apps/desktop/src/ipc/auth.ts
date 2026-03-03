import { ipcMain, shell } from 'electron'
import { createHash, randomBytes } from 'crypto'
import {
  getFlowscaleTokens,
  setFlowscaleTokens,
  clearFlowscaleTokens,
  type FlowscaleTokens,
} from '../config/store.js'

const FLOWSCALE_API_URL = 'https://dev-api.flowscale.ai'
// TODO: Register a new OAuth app for FlowScale EIOS at dev-api.flowscale.ai and update this client_id
const FLOWSCALE_CLIENT_ID = 'REPLACE_WITH_EIOS_CLIENT_ID'
const REDIRECT_URI = 'flowscaleeios://oauth/cb'

let pendingCodeVerifier: string | null = null

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function registerAuthIpc(): void {
  ipcMain.handle('auth:startFlowscaleOAuth', async () => {
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    pendingCodeVerifier = codeVerifier

    const params = new URLSearchParams({
      client_id: FLOWSCALE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'read write',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    const authorizeUrl = `${FLOWSCALE_API_URL}/api/v2/oauth/authorize?${params.toString()}`
    await shell.openExternal(authorizeUrl)
  })

  ipcMain.handle('auth:getFlowscaleTokens', () => {
    return getFlowscaleTokens()
  })

  ipcMain.handle('auth:clearFlowscaleTokens', () => {
    clearFlowscaleTokens()
  })
}

export async function handleOAuthCallback(
  callbackUrl: string,
  notifyRenderer: (tokens: FlowscaleTokens) => void,
): Promise<void> {
  const url = new URL(callbackUrl)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error || !code) {
    console.error('[auth] OAuth callback error:', error ?? 'missing code')
    pendingCodeVerifier = null
    return
  }

  if (!pendingCodeVerifier) {
    console.error('[auth] OAuth callback received but no pending code_verifier')
    return
  }

  const codeVerifier = pendingCodeVerifier
  pendingCodeVerifier = null

  try {
    const response = await fetch(`${FLOWSCALE_API_URL}/api/v2/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: FLOWSCALE_CLIENT_ID,
        code_verifier: codeVerifier,
      }).toString(),
    })

    if (!response.ok) {
      const body = await response.text()
      console.error('[auth] Token exchange failed:', response.status, body)
      return
    }

    const data = await response.json() as Record<string, unknown>
    const tokens: FlowscaleTokens = {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string) ?? null,
      username: (data.username as string) ?? null,
      teamId: (data.team_id as string) ?? null,
      teamName: (data.team_name as string) ?? null,
    }

    setFlowscaleTokens(tokens)
    notifyRenderer(tokens)
  } catch (err) {
    console.error('[auth] Token exchange error:', err)
  }
}
