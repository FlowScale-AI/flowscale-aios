'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Infinity as InfinityIcon, Copy, CheckCircle, ArrowRight } from 'phosphor-react'

export default function SetupView({ password }: { password: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="size-10 rounded-xl bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
            <InfinityIcon size={24} weight="bold" className="text-emerald-500" />
          </div>
          <span className="font-tech text-xl font-bold text-white tracking-tight">FlowScale</span>
        </div>

        <div className="bg-[var(--color-background-panel)] border border-white/5 rounded-2xl p-8">
          <h1 className="text-xl font-semibold text-white mb-2">Welcome to FlowScale</h1>
          <p className="text-sm text-zinc-400 mb-6">
            First-time setup complete. Your admin account has been created. Save these credentials
            — this screen will not appear again after you log in.
          </p>

          <div className="space-y-4 mb-6">
            <div>
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Username
              </label>
              <div className="mt-1 flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
                <span className="text-white font-mono flex-1">admin</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Password
              </label>
              <div className="mt-1 flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
                <span className="text-emerald-400 font-mono flex-1 tracking-widest">{password}</span>
                <button
                  onClick={handleCopy}
                  className="text-zinc-400 hover:text-white transition-colors shrink-0"
                  title="Copy password"
                >
                  {copied ? (
                    <CheckCircle size={16} weight="fill" className="text-emerald-400" />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 mb-6">
            <p className="text-xs text-amber-400">
              Change your password after logging in via the Users page.
            </p>
          </div>

          <Link
            href="/login"
            className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
          >
            Go to Login
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  )
}
