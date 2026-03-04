'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash } from 'phosphor-react'

type LogEntry = { id: number; ts: string; msg: string }

export function ComfyLogsPanel({ port }: { port: number }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef(0)

  function appendEntries(entries: { t: string; m: string }[]) {
    const next = entries.map((e) => ({ id: counterRef.current++, ts: e.t, msg: e.m }))
    setLogs((prev) => [...prev.slice(-(2000 - next.length)), ...next])
  }

  useEffect(() => {
    fetch(`/api/comfy/${port}/internal/logs/raw`)
      .then((r) => r.json())
      .then((d: { entries: { t: string; m: string }[] }) => appendEntries(d.entries))
      .catch(() => {})

    const controller = new AbortController()
    setConnected(false)

    ;(async () => {
      try {
        const res = await fetch(`/api/comfy/${port}/ws`, { signal: controller.signal })
        if (!res.ok || !res.body) return
        setConnected(true)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith('data: ')) continue
            try {
              const msg = JSON.parse(line.slice(6))
              if (msg.type === '_closed' || msg.type === '_error') {
                setConnected(false)
                continue
              }
              if (msg.type === 'logs' && Array.isArray(msg.data?.entries)) {
                appendEntries(msg.data.entries)
              }
            } catch {}
          }
        }
      } catch {
        // aborted
      } finally {
        setConnected(false)
      }
    })()

    return () => { controller.abort() }
  }, [port])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`size-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          <span className="text-xs text-zinc-500">{connected ? 'Live' : 'Historical'}</span>
        </div>
        <button
          onClick={() => setLogs([])}
          className="flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <Trash size={11} /> Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-black/30 rounded-xl p-3 font-mono text-xs min-h-0">
        {logs.length === 0 && (
          <p className="text-zinc-700 py-2 text-center">No logs yet…</p>
        )}
        {logs.map((entry) => {
          const isWarn = entry.msg.includes('WARNING') || entry.msg.includes('WARN')
          const isError = entry.msg.includes('ERROR') || entry.msg.includes('Error:')
          const color = isError ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-zinc-400'
          const time = entry.ts.slice(11, 19)
          return (
            <div key={entry.id} className="flex items-start gap-3 py-px leading-5">
              <span className="text-zinc-700 shrink-0 w-16">{time}</span>
              <span className={`${color} break-all whitespace-pre-wrap`}>{entry.msg.trimEnd()}</span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
