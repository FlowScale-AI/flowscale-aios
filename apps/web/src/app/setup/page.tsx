import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db'
import { setup } from '@/lib/db/schema'
import SetupView from './_view'

export const dynamic = 'force-dynamic'

export default function SetupPage() {
  const db = getDb()
  const row = db.select().from(setup).get()
  if (!row) redirect('/login')
  return <SetupView password={row.initialPassword} />
}
