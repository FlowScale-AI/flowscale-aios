'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  HardDrive, Globe, ArrowSquareOut, Copy, Check, Code, FolderOpen, X,
  ToggleLeft, ToggleRight,
  UserCircle, CheckCircle, XCircle, Trash, UserPlus, PencilSimple, Key,
} from 'phosphor-react'
import { PageTransition } from '@/components/ui'

// ─── Settings types ───────────────────────────────────────────────────────────

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

// ─── Users types ─────────────────────────────────────────────────────────────

type UserRow = {
  id: string
  username: string
  role: string
  status: string
  createdAt: number
  approvedAt: number | null
  approvedBy: string | null
}

const ROLES = ['admin', 'dev', 'artist']
const ROLE_LABELS: Record<string, string> = { admin: 'Admin', dev: 'Dev', artist: 'Artist' }
const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  disabled: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
}

function formatDate(ms: number | null) {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'general' | 'users'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general')
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
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Settings</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Network access and app configuration</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-8 pt-4 shrink-0">
        {(['general', 'users'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize',
              tab === t ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {t === 'general' ? 'General' : 'Users'}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'general' ? (
        <div className="flex-1 overflow-y-auto px-8 py-6">
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
                    <button onClick={() => copyUrl(`http://localhost:${network?.port ?? 14173}`)} className="p-1.5 text-zinc-500 hover:text-white transition-colors" title="Copy URL">
                      {copied === `http://localhost:${network?.port ?? 14173}` ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>
                    <button onClick={() => openInBrowser(`http://localhost:${network?.port ?? 14173}`)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-md transition-colors">
                      <ArrowSquareOut size={12} /> Open
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
                        <button onClick={() => openInBrowser(url)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-md transition-colors">
                          <ArrowSquareOut size={12} /> Open
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-zinc-600 mt-2">Use the network URL to open FlowScale AI OS from any device on the same network.</p>
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
              <p className="text-xs text-zinc-600 mt-2">All data stays on this machine. Nothing is sent to the cloud.</p>
            </section>

            {/* Developer Mode */}
            {canDevelop && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Code size={16} className="text-zinc-400" />
                    <h2 className="font-tech text-sm font-semibold text-zinc-200">Developer Mode</h2>
                  </div>
                  <button onClick={() => setDevMode((v) => !v)} className="text-zinc-400 hover:text-zinc-200 transition-colors" title={devMode ? 'Disable developer mode' : 'Enable developer mode'}>
                    {devMode ? <ToggleRight size={28} weight="fill" className="text-emerald-400" /> : <ToggleLeft size={28} className="text-zinc-600" />}
                  </button>
                </div>
                {!devMode && <p className="text-xs text-zinc-600">Enable to show developer tools for building and sideloading FlowScale apps.</p>}
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
                          <button onClick={handleBrowseDirectory} className="p-2 text-zinc-400 hover:text-zinc-200 bg-zinc-800 border border-zinc-700 rounded-lg transition-colors" title="Browse">
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
                      {sideloadError && <p className="text-xs text-red-400 mt-2">{sideloadError}</p>}
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
                              <button onClick={() => removeAppMutation.mutate(app.id)} className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors" title="Unload">
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
      ) : (
        <UsersPanel currentUserId={me?.id ?? null} />
      )}
    </PageTransition>
  )
}

// ─── Users Panel ──────────────────────────────────────────────────────────────

function UsersPanel({ currentUserId }: { currentUserId: string | null }) {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [usersTab, setUsersTab] = useState<'active' | 'pending'>('active')
  const [showAdd, setShowAdd] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [approveId, setApproveId] = useState<string | null>(null)
  const [approveRole, setApproveRole] = useState('artist')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      if (res.ok) setUsers(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const pending = users.filter((u) => u.status === 'pending')
  const active = users.filter((u) => u.status !== 'pending')

  async function approve(id: string, role: string) {
    await fetch(`/api/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active', role }) })
    setApproveId(null)
    load()
  }

  async function reject(id: string) {
    if (!confirm('Reject and delete this account request?')) return
    await fetch(`/api/users/${id}`, { method: 'DELETE' })
    load()
  }

  async function changeRole(id: string, role: string) {
    await fetch(`/api/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
    load()
  }

  async function toggleDisable(user: UserRow) {
    const newStatus = user.status === 'active' ? 'disabled' : 'active'
    await fetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) })
    load()
  }

  async function deleteUser(id: string, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    await fetch(`/api/users/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between px-8 py-3 shrink-0">
        <div className="flex gap-1">
          {(['active', 'pending'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setUsersTab(t)}
              className={[
                'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                usersTab === t ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300',
              ].join(' ')}
            >
              {t === 'pending' ? 'Pending Approval' : 'All Users'}
              <span className={['text-xs px-1.5 py-0.5 rounded-full', t === 'pending' ? (pending.length > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-white/5 text-zinc-600') : 'bg-white/5 text-zinc-400'].join(' ')}>
                {t === 'pending' ? pending.length : active.length}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
        >
          <UserPlus size={16} /> Add User
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-8 py-2">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">Loading…</div>
        ) : usersTab === 'pending' ? (
          pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <CheckCircle size={32} weight="fill" className="text-emerald-500/30" />
              <p className="text-zinc-500 text-sm">No pending requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((u) => (
                <div key={u.id} className="flex items-center gap-4 bg-[var(--color-background-panel)] border border-white/5 rounded-xl px-4 py-3">
                  <UserCircle size={32} className="text-zinc-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">{u.username}</div>
                    <div className="text-xs text-zinc-500">Requested {ROLE_LABELS[u.role] ?? u.role} · {formatDate(u.createdAt)}</div>
                  </div>
                  {approveId === u.id ? (
                    <div className="flex items-center gap-2">
                      <select value={approveRole} onChange={(e) => setApproveRole(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500/50">
                        {ROLES.map((r) => <option key={r} value={r} className="bg-zinc-900">{ROLE_LABELS[r]}</option>)}
                      </select>
                      <button onClick={() => approve(u.id, approveRole)} className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button onClick={() => setApproveId(null)} className="text-zinc-500 hover:text-zinc-300 transition-colors"><X size={16} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setApproveId(u.id); setApproveRole(u.role) }} className="flex items-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-500/20 transition-colors">
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button onClick={() => reject(u.id)} className="flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-500/20 transition-colors">
                        <XCircle size={14} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-3">
            {active.map((u) => (
              <div key={u.id} className="flex items-center gap-4 bg-[var(--color-background-panel)] border border-white/5 rounded-xl px-4 py-3">
                <UserCircle size={32} className="text-zinc-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{u.username}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_BADGE[u.status] ?? ''}`}>{u.status}</span>
                  </div>
                  <div className="text-xs text-zinc-500">Joined {formatDate(u.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {u.role === 'admin' ? (
                    <span className="px-2 py-1.5 text-xs text-zinc-400 bg-white/5 border border-white/10 rounded-lg">Admin</span>
                  ) : (
                    <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500/50 transition-colors" title="Change role">
                      {ROLES.filter((r) => r !== 'admin').map((r) => <option key={r} value={r} className="bg-zinc-900">{ROLE_LABELS[r]}</option>)}
                    </select>
                  )}
                  {u.id === currentUserId && (
                    <button onClick={() => setShowChangePassword(true)} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1" title="Change password">
                      <Key size={15} />
                    </button>
                  )}
                  {u.role !== 'admin' && (
                    <>
                      <button onClick={() => toggleDisable(u)} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1" title={u.status === 'active' ? 'Disable user' : 'Enable user'}>
                        <PencilSimple size={15} />
                      </button>
                      <button onClick={() => deleteUser(u.id, u.username)} className="text-zinc-600 hover:text-red-400 transition-colors p-1" title="Delete user">
                        <Trash size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onCreated={load} />}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (next !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setSuccess(true)
      setTimeout(onClose, 1200)
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-[var(--color-background-panel)] border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Change Password</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors"><X size={18} /></button>
        </div>
        {success ? (
          <div className="flex items-center gap-2 text-emerald-400 text-sm py-4 justify-center">
            <CheckCircle size={18} weight="fill" /> Password updated
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Current password</label>
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors" />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">New password</label>
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors" />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Confirm new password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors" />
            </div>
            {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 text-sm text-zinc-400 hover:text-zinc-200 bg-white/5 hover:bg-white/10 py-2.5 rounded-lg transition-colors">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">{loading ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function AddUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('artist')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create user'); return }
      onCreated()
      onClose()
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-[var(--color-background-panel)] border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Add User</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Username</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors" />
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors" />
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors">
              {ROLES.map((r) => <option key={r} value={r} className="bg-zinc-900">{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 text-sm text-zinc-400 hover:text-zinc-200 bg-white/5 hover:bg-white/10 py-2.5 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">{loading ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
