import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface FlowscaleTokens {
  accessToken: string | null
  refreshToken: string | null
  username: string | null
  teamId: string | null
  teamName: string | null
}

const emptyTokens: FlowscaleTokens = {
  accessToken: null,
  refreshToken: null,
  username: null,
  teamId: null,
  teamName: null,
}

function getStorePath(): string {
  return join(app.getPath('userData'), 'flowscale-eios-auth.json')
}

export function getFlowscaleTokens(): FlowscaleTokens {
  const p = getStorePath()
  if (!existsSync(p)) return { ...emptyTokens }
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as FlowscaleTokens
  } catch {
    return { ...emptyTokens }
  }
}

export function setFlowscaleTokens(tokens: FlowscaleTokens): void {
  writeFileSync(getStorePath(), JSON.stringify(tokens, null, 2), 'utf-8')
}

export function clearFlowscaleTokens(): void {
  setFlowscaleTokens({ ...emptyTokens })
}
