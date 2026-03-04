import { NextRequest, NextResponse } from 'next/server'
import { deleteSession } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('fs_session')?.value
  if (token) deleteSession(token)

  const response = NextResponse.json({ ok: true })
  response.cookies.set('fs_session', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
