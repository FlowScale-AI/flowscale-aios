import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getSessionUser } from '@/lib/auth'

export default async function ComfyUILayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies()
  const token = cookieStore.get('fs_session')?.value
  const user = token ? getSessionUser(token) : null

  if (!user || user.role === 'artist') redirect('/apps')

  return <>{children}</>
}
