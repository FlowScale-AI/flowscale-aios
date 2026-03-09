'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, WarningCircle, Spinner, Stop } from 'phosphor-react'

export type InferenceStatus = 'checking' | 'running' | 'starting' | 'stopped'

// Shared status so the bottom tabs can react to it
let _globalStatus: InferenceStatus = 'checking'
const _listeners = new Set<(s: InferenceStatus) => void>()
function setGlobalStatus(s: InferenceStatus) {
  _globalStatus = s
  _listeners.forEach((fn) => fn(s))
}
export function useInferenceStatus(): InferenceStatus {
  const [s, setS] = useState<InferenceStatus>(_globalStatus)
  useEffect(() => {
    _listeners.add(setS)
    return () => { _listeners.delete(setS) }
  }, [])
  return s
}

export function LocalInferenceSetup() {
  const [status, setStatus] = useState<InferenceStatus>('checking')
  const [installing, setInstalling] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusRef = useRef<InferenceStatus>('checking')
  const failCountRef = useRef(0)

  function applyStatus(next: InferenceStatus) {
    statusRef.current = next
    setStatus(next)
    setGlobalStatus(next)
  }

  async function checkStatus() {
    try {
      const res = await fetch('/api/local-inference/status')
      const { running } = await res.json() as { running: boolean }
      if (running) {
        failCountRef.current = 0
        applyStatus('running')
      } else {
        failCountRef.current++
        // Only transition to stopped after 6 consecutive failures (~12s) —
        // CPU inference holds the GIL and can briefly block health checks
        if (failCountRef.current >= 6) {
          applyStatus(statusRef.current === 'starting' ? 'starting' : 'stopped')
        }
      }
    } catch {
      failCountRef.current++
      if (failCountRef.current >= 6 && statusRef.current !== 'starting') applyStatus('stopped')
    }
  }

  useEffect(() => {
    checkStatus()
    pollRef.current = setInterval(checkStatus, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // Navigation guard — warn when model is downloading / deps installing
  const isActive = installing || status === 'starting'
  useEffect(() => {
    if (!isActive) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isActive])

  // Intercept in-app link clicks when download/install is active
  useEffect(() => {
    if (!isActive) return
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('#')) return
      // It's an internal navigation — confirm before allowing
      const ok = window.confirm(
        'The inference server is still setting up (downloading model / installing dependencies). ' +
        'It will continue in the background, but you won\'t be able to see progress.\n\n' +
        'Leave this page?'
      )
      if (!ok) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // Use capture phase to intercept before Next.js router handles it
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [isActive])

  async function handleInstall() {
    setInstalling(true)
    setError(null)
    failCountRef.current = 0

    try {
      const res = await fetch('/api/local-inference/install', { method: 'POST' })
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6)) as { log?: string; error?: string; done?: boolean; starting?: boolean }
            if (payload.error) { setError(payload.error); break }
            if (payload.starting) applyStatus('starting')
            if (payload.done) applyStatus('running')
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed')
    } finally {
      setInstalling(false)
      checkStatus()
    }
  }

  async function handleStop() {
    setStopping(true)
    try {
      await fetch('/api/local-inference/stop', { method: 'POST' })
      applyStatus('stopped')
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="border-b border-white/5 bg-zinc-950/50">
      <div className="flex items-center gap-3 px-6 py-2.5">
        <div className="flex items-center gap-2 flex-1">
          {(status === 'checking' || installing) && <Spinner size={13} className="text-zinc-400 animate-spin" />}
          {status === 'running' && !installing && <CheckCircle size={13} weight="fill" className="text-emerald-500" />}
          {status === 'stopped' && !installing && <WarningCircle size={13} weight="fill" className="text-amber-500" />}
          {status === 'starting' && !installing && <Spinner size={13} className="text-amber-400 animate-spin" />}
          <span className="text-xs text-zinc-400">
            {status === 'checking' && !installing && 'Checking inference server…'}
            {status === 'running' && !installing && <span className="text-emerald-400">Local inference server running</span>}
            {status === 'starting' && !installing && <span className="text-amber-400">Loading model… check Logs tab for progress</span>}
            {status === 'stopped' && !installing && 'Inference server not running'}
            {installing && <span className="text-emerald-400">Installing dependencies…</span>}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {(status === 'running' || status === 'starting') && (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-md transition-colors disabled:opacity-50"
            >
              <Stop size={11} weight="fill" />
              {stopping ? 'Stopping…' : 'Stop Server'}
            </button>
          )}
          {(status === 'stopped' || status === 'starting') && (
            <button
              onClick={handleInstall}
              disabled={installing || status === 'starting'}
              className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-black bg-emerald-400 hover:bg-emerald-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {installing ? <><Spinner size={11} className="animate-spin" /> Installing…</>
                : status === 'starting' ? <><Spinner size={11} className="animate-spin" /> Loading…</>
                : 'Start'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-6 mb-2 px-3 py-2 bg-red-950/40 border border-red-900/40 rounded-lg text-xs text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}
