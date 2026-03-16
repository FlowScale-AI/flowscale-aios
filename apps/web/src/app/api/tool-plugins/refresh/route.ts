import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { autoRegisterCustomPlugins } from '@/lib/toolPlugins'

export async function POST() {
  const db = getDb()
  const registered = await autoRegisterCustomPlugins(db)
  return NextResponse.json({ registered })
}
