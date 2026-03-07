'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HardDrive, Globe, ArrowSquareOut, Copy, Check, Code, FolderOpen, X, ToggleLeft, ToggleRight } from 'phosphor-react'
import { PageTransition } from '@/components/ui'

interface UserMe {
  id: string
  username: string
  role: string
}

interface SideloadedApp {
  id: string
  displayName: string
  bundlePath: string
  installedAt: number
}

interface NetworkData {
  port: number
  addresses: string[]
}

export default function SettingsPage() {
  const queryClient = useQueryClient()

  const { data: network } = useQuery<NetworkData>({
    queryKey: ['network'],
    queryFn: async () => {
      const res = await fetch('/api/settings/network')
      if (!res.ok) throw new Error('Failed to fetch network info')
      return res.json()
    },
  })

  const { data: me } = useQuery<UserMe>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me')
      if (!res.ok) throw new Error('Failed to fetch user')
      return res.json()
    },
  })

  const canDevelop = me?.role === 'admin' || me?.role === 'dev'

  const [devMode, setDevMode] = useState(false)
  const [sideloadPath, setSideloadPath] = useState('')
  const [sideloadError, setSideloadError] = useState<string | null>(null)

  const { data: sideloadedApps = [], refetch: refetchApps } = useQuery<SideloadedApp[]>({
    queryKey: ['sideloaded-apps'],
    queryFn: async () => {
      const res = await fetch('/api/apps?source=sideloaded')
      if (!res.ok) return []
      return res.json()
    },
    enabled: canDevelop,
  })

  const sideloadMutation = useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch('/api/apps/sideload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Sideload failed')
      return data
    },
    onSuccess: () => {
      setSideloadPath('')
      setSideloadError(null)
      refetchApps()
      queryClient.invalidateQueries({ queryKey: ['installed-apps'] })
    },
    onError: (err: Error) => setSideloadError(err.message),
  })

  const removeAppMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/apps/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove app')
    },
    onSuccess: () => {
      refetchApps()
      queryClient.invalidateQueries({ queryKey: ['installed-apps'] })
    },
  })

  async function handleBrowseDirectory() {
    if (window.desktop?.dialog?.openDirectory) {
      const dir = await window.desktop.dialog.openDirectory()
      if (dir) setSideloadPath(dir)
    }
  }

  const [copied, setCopied] = useState<string | null>(null)

  const openInBrowser = (url: string) => {
    if (window.desktop?.shell?.openExternal) {
      window.desktop.shell.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Settings</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Network access and app configuration</p>
        </div>
      </div>

      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-8">

          {/* Network Access */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Globe size={16} className="text-zinc-400" />
              <h2 className="font-tech text-sm font-semibold text-zinc-200">Network Access</h2>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between p-4 bg-zinc-900/50 border border-white/5 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-zinc-500 mb-1">Local</div>
                  <span className="text-sm font-mono-custom text-zinc-300">http://localhost:{network?.port ?? 14173}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <button
                    onClick={() => copyUrl(`http://localhost:${network?.port ?? 14173}`)}
                    className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                    title="Copy URL"
                  >
                    {copied === `http://localhost:${network?.port ?? 14173}` ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                  <button
                    onClick={() => openInBrowser(`http://localhost:${network?.port ?? 14173}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-md transition-colors"
                  >
                    <ArrowSquareOut size={12} />
                    Open
                  </button>
                </div>
              </div>

              {network?.addresses.map((ip) => {
                const url = `http://${ip}:${network.port}`
                return (
                  <div key={ip} className="flex items-center justify-between p-4 bg-zinc-900/50 border border-white/5 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-zinc-500 mb-1">Network</div>
                      <span className="text-sm font-mono-custom text-zinc-300">{url}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <button onClick={() => copyUrl(url)} className="p-1.5 text-zinc-500 hover:text-white transition-colors" title="Copy URL">
                        {copied === url ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                      <button
                        onClick={() => openInBrowser(url)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-md transition-colors"
                      >
                        <ArrowSquareOut size={12} />
                        Open
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-zinc-600 mt-2">
              Use the network URL to open FlowScale AI OS from any device on the same network.
            </p>
          </section>

          {/* Storage */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <HardDrive size={16} className="text-zinc-400" />
              <h2 className="font-tech text-sm font-semibold text-zinc-200">Storage</h2>
            </div>
            <div className="flex flex-col gap-3 p-4 bg-zinc-900/50 border border-white/5 rounded-lg text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Database</span>
                <span className="text-zinc-300 font-mono-custom text-xs">~/.flowscale/aios.db</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">App data</span>
                <span className="text-zinc-300 font-mono-custom text-xs">~/.flowscale/app-data/</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">App bundles</span>
                <span className="text-zinc-300 font-mono-custom text-xs">~/.flowscale/apps/</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Outputs</span>
                <span className="text-zinc-300 font-mono-custom text-xs">~/.flowscale/aios-outputs/</span>
              </div>
            </div>
            <p className="text-xs text-zinc-600 mt-2">
              All data stays on this machine. Nothing is sent to the cloud.
            </p>
          </section>

          {/* Developer Mode — only shown to admin/dev */}
          {canDevelop && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Code size={16} className="text-zinc-400" />
                  <h2 className="font-tech text-sm font-semibold text-zinc-200">Developer Mode</h2>
                </div>
                <button
                  onClick={() => setDevMode((v) => !v)}
                  className="text-zinc-400 hover:text-zinc-200 transition-colors"
                  title={devMode ? 'Disable developer mode' : 'Enable developer mode'}
                >
                  {devMode
                    ? <ToggleRight size={28} weight="fill" className="text-emerald-400" />
                    : <ToggleLeft size={28} className="text-zinc-600" />}
                </button>
              </div>

              {!devMode && (
                <p className="text-xs text-zinc-600">
                  Enable to show developer tools for building and sideloading FlowScale apps.
                </p>
              )}

              {devMode && (
                <div className="p-4 bg-zinc-900/50 border border-white/5 rounded-xl space-y-3">
                  <div>
                    <p className="text-xs text-zinc-400 mb-3">
                      Load an app from a local directory for testing. Point to a directory containing a{' '}
                      <span className="font-mono-custom">flowscale.app.json</span> manifest.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="/absolute/path/to/my-app"
                        value={sideloadPath}
                        onChange={(e) => { setSideloadPath(e.target.value); setSideloadError(null) }}
                        className="flex-1 px-3 py-2 text-xs font-mono-custom bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                      />
                      {window.desktop?.dialog && (
                        <button
                          onClick={handleBrowseDirectory}
                          className="p-2 text-zinc-400 hover:text-zinc-200 bg-zinc-800 border border-zinc-700 rounded-lg transition-colors"
                          title="Browse"
                        >
                          <FolderOpen size={15} />
                        </button>
                      )}
                      <button
                        disabled={!sideloadPath.trim() || sideloadMutation.isPending}
                        onClick={() => sideloadMutation.mutate(sideloadPath.trim())}
                        className="px-4 py-2 text-xs font-medium text-zinc-200 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {sideloadMutation.isPending ? 'Loading…' : 'Load'}
                      </button>
                    </div>
                    {sideloadError && (
                      <p className="text-xs text-red-400 mt-2">{sideloadError}</p>
                    )}
                  </div>

                  {sideloadedApps.length > 0 && (
                    <div>
                      <p className="text-xs text-zinc-500 font-semibold mb-2">Currently sideloaded</p>
                      <div className="flex flex-col gap-1.5">
                        {sideloadedApps.map((app) => (
                          <div key={app.id} className="flex items-center justify-between p-3 bg-zinc-800/50 border border-white/5 rounded-lg">
                            <div>
                              <div className="text-sm text-zinc-200 font-medium">{app.displayName}</div>
                              <div className="text-xs font-mono-custom text-zinc-500 mt-0.5">{app.bundlePath}</div>
                            </div>
                            <button
                              onClick={() => removeAppMutation.mutate(app.id)}
                              className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
                              title="Unload"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* App info */}
          <section className="pt-4 border-t border-white/5">
            <div className="flex justify-between text-xs text-zinc-600">
              <span className="font-tech">FlowScale AI OS</span>
              <span className="font-mono-custom">v0.2.0</span>
            </div>
          </section>

        </div>
      </div>
    </PageTransition>
  )
}
