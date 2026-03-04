'use client'

import { useState, useEffect, type FormEvent } from 'react'
import {
  UserCircle,
  CheckCircle,
  XCircle,
  Trash,
  UserPlus,
  X,
  PencilSimple,
  Key,
} from 'phosphor-react'

type UserRow = {
  id: string
  username: string
  role: string
  status: string
  createdAt: number
  approvedAt: number | null
  approvedBy: string | null
}

const ROLES = ['admin', 'pipeline_td', 'dev', 'artist']
const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  pipeline_td: 'Pipeline TD',
  dev: 'Dev',
  artist: 'Artist',
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  disabled: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
}

function formatDate(ms: number | null) {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'pending'>('active')
  const [showAdd, setShowAdd] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [approveId, setApproveId] = useState<string | null>(null)
  const [approveRole, setApproveRole] = useState('artist')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      if (res.ok) setUsers(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    fetch('/api/auth/me').then((r) => r.json()).then((d) => setCurrentUserId(d.id ?? null))
  }, [])

  const pending = users.filter((u) => u.status === 'pending')
  const active = users.filter((u) => u.status !== 'pending')

  async function approve(id: string, role: string) {
    await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', role }),
    })
    setApproveId(null)
    load()
  }

  async function reject(id: string) {
    if (!confirm('Reject and delete this account request?')) return
    await fetch(`/api/users/${id}`, { method: 'DELETE' })
    load()
  }

  async function changeRole(id: string, role: string) {
    await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    load()
  }

  async function toggleDisable(user: UserRow) {
    const newStatus = user.status === 'active' ? 'disabled' : 'active'
    await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    load()
  }

  async function deleteUser(id: string, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    await fetch(`/api/users/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">Users</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Manage team members and access requests</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
        >
          <UserPlus size={16} />
          Add User
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 shrink-0">
        {(['active', 'pending'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
              tab === t
                ? 'bg-white/10 text-white'
                : 'text-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {t === 'pending' ? 'Pending Approval' : 'All Users'}
            <span className={[
              'text-xs px-1.5 py-0.5 rounded-full',
              t === 'pending'
                ? pending.length > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-white/5 text-zinc-600'
                : 'bg-white/5 text-zinc-400',
            ].join(' ')}>
              {t === 'pending' ? pending.length : active.length}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
            Loading…
          </div>
        ) : tab === 'pending' ? (
          pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <CheckCircle size={32} weight="fill" className="text-emerald-500/30" />
              <p className="text-zinc-500 text-sm">No pending requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-4 bg-[var(--color-background-panel)] border border-white/5 rounded-xl px-4 py-3"
                >
                  <UserCircle size={32} className="text-zinc-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">{u.username}</div>
                    <div className="text-xs text-zinc-500">
                      Requested {ROLE_LABELS[u.role] ?? u.role} · {formatDate(u.createdAt)}
                    </div>
                  </div>
                  {approveId === u.id ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={approveRole}
                        onChange={(e) => setApproveRole(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500/50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r} className="bg-zinc-900">
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => approve(u.id, approveRole)}
                        className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button
                        onClick={() => setApproveId(null)}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setApproveId(u.id); setApproveRole(u.role) }}
                        className="flex items-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-500/20 transition-colors"
                      >
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button
                        onClick={() => reject(u.id)}
                        className="flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-500/20 transition-colors"
                      >
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
              <div
                key={u.id}
                className="flex items-center gap-4 bg-[var(--color-background-panel)] border border-white/5 rounded-xl px-4 py-3"
              >
                <UserCircle size={32} className="text-zinc-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{u.username}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_BADGE[u.status] ?? ''}`}
                    >
                      {u.status}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">Joined {formatDate(u.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {u.role === 'admin' ? (
                    <span className="px-2 py-1.5 text-xs text-zinc-400 bg-white/5 border border-white/10 rounded-lg">
                      Admin
                    </span>
                  ) : (
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500/50 transition-colors"
                      title="Change role"
                    >
                      {ROLES.filter((r) => r !== 'admin').map((r) => (
                        <option key={r} value={r} className="bg-zinc-900">
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  )}
                  {u.id === currentUserId && (
                    <button
                      onClick={() => setShowChangePassword(true)}
                      className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                      title="Change password"
                    >
                      <Key size={15} />
                    </button>
                  )}
                  {u.role !== 'admin' && (
                    <>
                      <button
                        onClick={() => toggleDisable(u)}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                        title={u.status === 'active' ? 'Disable user' : 'Enable user'}
                      >
                        <PencilSimple size={15} />
                      </button>
                      <button
                        onClick={() => deleteUser(u.id, u.username)}
                        className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                        title="Delete user"
                      >
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
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={18} />
          </button>
        </div>
        {success ? (
          <div className="flex items-center gap-2 text-emerald-400 text-sm py-4 justify-center">
            <CheckCircle size={18} weight="fill" /> Password updated
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Current password</label>
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors" />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">New password</label>
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors" />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Confirm new password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors" />
            </div>
            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 text-sm text-zinc-400 hover:text-zinc-200 bg-white/5 hover:bg-white/10 py-2.5 rounded-lg transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
                {loading ? 'Saving…' : 'Save'}
              </button>
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
      if (!res.ok) {
        setError(data.error ?? 'Failed to create user')
        return
      }
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
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
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
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
            >
              {ROLES.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 text-sm text-zinc-400 hover:text-zinc-200 bg-white/5 hover:bg-white/10 py-2.5 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
