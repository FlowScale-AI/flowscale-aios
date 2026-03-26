import { Suspense } from 'react'
import { getDb } from '@/lib/db'
import { setup } from '@/lib/db/schema'
import LoginForm from './_form'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const db = getDb()
  const setupRow = db.select().from(setup).get()
  return (
    <Suspense>
      <LoginForm initialPassword={setupRow?.initialPassword} />
    </Suspense>
  )
}
