'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Copy, CheckCircle } from 'phosphor-react'

export default function LoginForm({ initialPassword }: { initialPassword?: string }) {
  const router = useRouter()
  const [username, setUsername] = useState(initialPassword ? 'admin' : '')
  const [password, setPassword] = useState(initialPassword ?? '')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleCopy() {
    if (!initialPassword) return
    navigator.clipboard.writeText(initialPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        return
      }

      router.push('/apps')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <Image src="/flowscale-logo-full.png" alt="FlowScale AI" width={200} height={48} priority />
        </div>

        {initialPassword && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-4">
            <p className="text-xs font-medium text-amber-400 mb-3">
              First-time setup — save these credentials before continuing
            </p>
            <div className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2">
              <span className="text-xs text-zinc-300">
                <span className="text-zinc-500">admin</span>
                <span className="text-zinc-600 mx-2">/</span>
                <span className="font-mono text-emerald-400 tracking-widest">{initialPassword}</span>
              </span>
              <button onClick={handleCopy} className="text-zinc-400 hover:text-white transition-colors ml-3 shrink-0">
                {copied ? <CheckCircle size={14} weight="fill" className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}

        <div className="bg-[var(--color-background-panel)] border border-white/5 rounded-2xl p-8">
          <h1 className="text-lg font-semibold text-white mb-6">Sign in</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                placeholder="Enter your password"
              />
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
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-zinc-500 mt-4">
          Need access?{' '}
          <Link href="/register" className="text-emerald-400 hover:text-emerald-300 transition-colors">
            Request an account
          </Link>
        </p>
      </div>
    </div>
  )
}
