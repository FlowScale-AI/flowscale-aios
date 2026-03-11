'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, CheckCircle, WarningCircle, CircleNotch, ArrowRight, DownloadSimple } from 'phosphor-react'
import type { AppRegistryEntry } from '@/lib/registry/appRegistry'

interface InstallModalProps {
  entry: AppRegistryEntry
  onClose: () => void
  onInstalled: (appId: string) => void
}

type Step = 'info' | 'deps' | 'downloading' | 'installing' | 'done'

interface DepsResult {
  ok: boolean
  missingModels: Array<{ toolId: string; modelLabel: string; folder: string; filename: string; downloadUrl?: string }>
  missingCustomNodes: Array<{ name: string; repo: string }>
  unconfiguredProviders: string[]
}

export default function InstallModal({ entry, onClose, onInstalled }: InstallModalProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('info')
  const [deps, setDeps] = useState<DepsResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function checkDeps() {
    setStep('deps')
    setError(null)
    try {
      const res = await fetch('/api/apps/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id }),
      })
      const data = await res.json() as DepsResult & { status?: string; error?: string }

      if (data.error) { setError(data.error); return }

      if (data.status === 'installed') {
        // No missing deps — install completed immediately
        queryClient.invalidateQueries({ queryKey: ['installed-apps'] })
        queryClient.invalidateQueries({ queryKey: ['sideloaded-apps'] })
        setStep('done')
        return
      }

      if (data.status === 'missing_deps') {
        setDeps(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed')
    }
  }

  async function installWithModels(downloadModels: boolean) {
    setStep(downloadModels ? 'downloading' : 'installing')
    setError(null)
    try {
      const res = await fetch('/api/apps/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, force: true, downloadModels }),
      })
      const data = await res.json() as { status?: string; error?: string; details?: string[] }
      if (data.error) {
        setError(data.details ? `${data.error}: ${data.details.join('; ')}` : data.error)
        setStep('deps')
        return
      }
      queryClient.invalidateQueries({ queryKey: ['installed-apps'] })
      queryClient.invalidateQueries({ queryKey: ['sideloaded-apps'] })
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed')
      setStep('deps')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-[480px] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
          <div>
            <h2 className="font-tech text-base font-semibold text-zinc-100">{entry.displayName}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">by {entry.author} · v{entry.latestRelease}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {/* Step 1: Info */}
          {step === 'info' && (
            <>
              <p className="text-sm text-zinc-400 mb-5">{entry.description}</p>

              <div className="mb-5">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Permissions</p>
                <div className="flex flex-wrap gap-1.5">
                  {entry.permissions.map((p) => (
                    <span key={p} className="px-2 py-0.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300">
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              {entry.tools_used && entry.tools_used.length > 0 && (
                <div className="mb-5">
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Uses tools</p>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.tools_used.map((t) => (
                      <span key={t} className="px-2 py-0.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={checkDeps}
                className="w-full py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                Install <ArrowRight size={14} />
              </button>
            </>
          )}

          {/* Step 2: Dep check results */}
          {step === 'deps' && deps && (
            <>
              {deps.ok ? (
                <div className="flex items-center gap-2 text-emerald-400 mb-4">
                  <CheckCircle size={18} weight="fill" />
                  <span className="text-sm">All dependencies satisfied</span>
                </div>
              ) : (
                <>
                  {deps.missingCustomNodes?.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Required custom nodes</p>
                      {deps.missingCustomNodes.map((n, i) => (
                        <div key={i} className="flex items-center gap-2 py-2 border-b border-white/5 last:border-0">
                          <WarningCircle size={14} className="text-amber-400 shrink-0" />
                          <span className="text-xs text-zinc-300 flex-1">{n.name}</span>
                          <span className="text-[10px] text-zinc-600 font-mono">custom_nodes/</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {deps.missingModels.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Missing models</p>
                      {deps.missingModels.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 py-2 border-b border-white/5 last:border-0">
                          <WarningCircle size={14} className="text-amber-400 shrink-0" />
                          <span className="text-xs text-zinc-300 flex-1">{m.modelLabel}</span>
                          <span className="text-[10px] text-zinc-600 font-mono">{m.folder}/</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {deps.unconfiguredProviders.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Unconfigured providers</p>
                      {deps.unconfiguredProviders.map((p) => (
                        <div key={p} className="flex items-center gap-2 py-1.5">
                          <WarningCircle size={14} className="text-amber-400" />
                          <span className="text-xs text-zinc-300">{p}</span>
                          <span className="text-xs text-zinc-500 ml-auto">→ Settings &gt; Cloud Providers</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

              <div className="flex gap-2 mt-4">
                <button onClick={onClose} className="flex-1 py-2 text-sm text-zinc-400 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors">
                  Cancel
                </button>
                {deps.ok ? (
                  <button
                    onClick={() => installWithModels(false)}
                    className="flex-1 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    Install
                  </button>
                ) : (deps.missingModels.some((m) => m.downloadUrl) || (deps.missingCustomNodes?.length > 0)) ? (
                  <button
                    onClick={() => installWithModels(true)}
                    className="flex-1 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    <DownloadSimple size={14} /> Download &amp; Install
                  </button>
                ) : (
                  <button
                    onClick={() => installWithModels(false)}
                    className="flex-1 py-2 text-sm text-white bg-zinc-700 hover:bg-zinc-600 rounded-xl transition-colors"
                  >
                    Install anyway
                  </button>
                )}
              </div>
            </>
          )}

          {/* Step 2 loading state */}
          {step === 'deps' && !deps && !error && (
            <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
              <CircleNotch size={18} className="animate-spin" />
              <span className="text-sm">Checking dependencies…</span>
            </div>
          )}

          {/* Step 3: Downloading models */}
          {step === 'downloading' && (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-zinc-400">
              <CircleNotch size={18} className="animate-spin" />
              <span className="text-sm">Downloading models &amp; installing nodes…</span>
              <span className="text-xs text-zinc-600">This may take several minutes for large models</span>
            </div>
          )}

          {/* Step 4: Installing */}
          {step === 'installing' && (
            <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
              <CircleNotch size={18} className="animate-spin" />
              <span className="text-sm">Installing {entry.displayName}…</span>
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <>
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle size={40} weight="fill" className="text-emerald-400" />
                <p className="text-sm font-medium text-zinc-200">{entry.displayName} installed!</p>
                <p className="text-xs text-zinc-500 text-center">The app is now available in the sidebar.</p>
              </div>
              <button
                onClick={() => { onInstalled(entry.id); onClose() }}
                className="w-full py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors"
              >
                Open App
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
