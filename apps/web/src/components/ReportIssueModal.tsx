'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui'

const REPORT_URL = '/api/report-issue'

type State = 'idle' | 'submitting' | 'success' | 'error'

export default function ReportIssueModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit() {
    if (!description.trim()) return
    setState('submitting')
    setErrorMsg('')

    try {
      let version: string | undefined
      let platform: string | undefined
      let logs: string | undefined

      if (window.desktop?.report) {
        const info = await window.desktop.report.getSystemInfo()
        version = info.version
        platform = info.platform
        logs = info.logs
      } else {
        version = process.env.NEXT_PUBLIC_APP_VERSION ?? undefined
        platform = navigator.userAgent
      }

      const res = await fetch(REPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, email: email.trim() || undefined, version, platform, logs }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
      }

      setState('success')
      setDescription('')
      setEmail('')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  function handleClose() {
    if (state === 'submitting') return
    setState('idle')
    setErrorMsg('')
    setDescription('')
    setEmail('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Report an Issue" maxWidth="max-w-lg">
      {state === 'success' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="size-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <svg className="size-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-zinc-300 font-medium">Report submitted</p>
          <p className="text-xs text-zinc-500">Thanks for helping us improve FlowScale AIOS.</p>
          <button
            onClick={handleClose}
            className="mt-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-zinc-500">
            Describe what happened. App version, OS info, and recent logs will be attached automatically.
          </p>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com (optional)"
            className="w-full rounded-lg bg-zinc-900 border border-zinc-800 focus:border-emerald-500/50 focus:outline-none px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 transition-colors"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. The app crashed when I clicked Run on a tool…"
            rows={5}
            className="w-full resize-none rounded-lg bg-zinc-900 border border-zinc-800 focus:border-emerald-500/50 focus:outline-none px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 transition-colors"
          />

          {state === 'error' && (
            <p className="text-xs text-red-400">{errorMsg}</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={handleClose}
              disabled={state === 'submitting'}
              className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!description.trim() || state === 'submitting'}
              className="px-4 py-2 rounded-lg bg-zinc-100 text-black text-sm font-medium hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {state === 'submitting' ? 'Sending…' : 'Submit Report'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
