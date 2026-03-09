import { useState, useEffect } from 'react'
import { apiClient } from '../api/client'
import type { CurrentUser } from '../types'

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: CurrentUser }

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    apiClient.me()
      .then((user) => setAuth({ status: 'authenticated', user }))
      .catch(() => setAuth({ status: 'unauthenticated' }))
  }, [])

  async function login(username: string, password: string) {
    const user = await apiClient.login(username, password)
    setAuth({ status: 'authenticated', user })
  }

  async function logout() {
    await apiClient.logout().catch(() => { })
    setAuth({ status: 'unauthenticated' })
  }

  return { auth, login, logout }
}
