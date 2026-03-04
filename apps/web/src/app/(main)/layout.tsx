import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getSessionUser } from '@/lib/auth'
import type { Role } from '@/lib/auth'
import { CanvasStateProvider } from '@/features/canvases/components/CanvasStateContext'
import Sidebar from './_Sidebar'

export default async function MainLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies()
  const token = cookieStore.get('fs_session')?.value
  if (!token) redirect('/login')

  const user = getSessionUser(token)
  if (!user) redirect('/login')

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      <Sidebar role={user.role as Role} username={user.username} />
      <main className="flex-1 overflow-hidden">
        <CanvasStateProvider>{children}</CanvasStateProvider>
      </main>
    </div>
  )
}
