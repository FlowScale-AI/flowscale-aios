'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Infinity as InfinityIcon, CheckCircle } from 'phosphor-react'

const ROLES = [
  { value: 'artist', label: 'Artist', description: 'Access to Apps and Canvas' },
  { value: 'dev', label: 'Dev', description: 'Access to Build Tool, Apps, Canvas, and Settings' },
]

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [role, setRole] = useState('artist')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Registration failed')
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="size-10 rounded-xl bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
              <InfinityIcon size={24} weight="bold" className="text-emerald-500" />
            </div>
            <span className="font-tech text-xl font-bold text-white tracking-tight">FlowScale</span>
          </div>
          <div className="bg-[var(--color-background-panel)] border border-white/5 rounded-2xl p-8 text-center">
            <CheckCircle size={40} weight="fill" className="text-emerald-400 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-white mb-2">Request submitted</h2>
            <p className="text-sm text-zinc-400 mb-6">
              Your account is pending approval by an admin or Pipeline TD. You'll be able to sign in
              once it's approved.
            </p>
            <Link
              href="/login"
              className="text-emerald-400 hover:text-emerald-300 text-sm transition-colors"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="size-10 rounded-xl bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
            <InfinityIcon size={24} weight="bold" className="text-emerald-500" />
          </div>
          <span className="font-tech text-xl font-bold text-white tracking-tight">FlowScale</span>
        </div>

        <div className="bg-[var(--color-background-panel)] border border-white/5 rounded-2xl p-8">
          <h1 className="text-lg font-semibold text-white mb-6">Request access</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                minLength={3}
                maxLength={32}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                placeholder="Choose a username"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                placeholder="Repeat password"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-2">Role</label>
              <div className="space-y-2">
                {ROLES.map((r) => (
                  <label
                    key={r.value}
                    className={[
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      role === r.value
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : 'border-white/10 bg-white/5 hover:border-white/20',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r.value}
                      checked={role === r.value}
                      onChange={() => setRole(r.value)}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">{r.label}</div>
                      <div className="text-xs text-zinc-500">{r.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors mt-2"
            >
              {loading ? 'Submitting…' : 'Request access'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-zinc-500 mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-emerald-400 hover:text-emerald-300 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
