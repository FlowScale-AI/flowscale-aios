'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DotsThree, ArrowLeft, Trash, ShieldCheck, Info, ArrowClockwise } from 'phosphor-react'
import AppFrame from '@/components/AppFrame'
import type { AppManifest } from '@/lib/appManifest'

interface InstalledAppFull {
  id: string
  displayName: string
  name: string
  source: string
  bundlePath: string
  installedAt: number
  manifest: AppManifest
}

function AppMenu({
  app,
  onUninstall,
  onClose,
}: {
  app: InstalledAppFull
  onUninstall: () => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl border border-white/10 bg-zinc-900 shadow-2xl shadow-black/50 overflow-hidden">
        <div className="p-3 border-b border-white/5">
          <p className="text-xs font-semibold text-zinc-200">{app.displayName}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {app.source === 'sideloaded' ? 'Sideloaded' : 'Installed from registry'}
          </p>
        </div>
        <div className="py-1">
          <button
            onClick={() => { onClose(); window.location.reload() }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors text-left"
          >
            <ArrowClockwise size={13} />
            Reload app
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors text-left"
            onClick={() => {
              alert(`Permissions:\n${(app.manifest.permissions ?? []).join('\n') || 'None'}`)
              onClose()
            }}
          >
            <ShieldCheck size={13} />
            App permissions
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors text-left"
            onClick={() => {
              alert(`App: ${app.displayName}\nID: ${app.id}\nSource: ${app.source}\nInstalled: ${new Date(app.installedAt).toLocaleDateString()}`)
              onClose()
            }}
          >
            <Info size={13} />
            About this app
          </button>
          {app.source !== 'built-in' && (
            <>
              <div className="border-t border-white/5 my-1" />
              <button
                onClick={() => { onClose(); onUninstall() }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-950/40 transition-colors text-left"
              >
                <Trash size={13} />
                Uninstall
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default function InstalledAppPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)

  const { data: app, isLoading } = useQuery<InstalledAppFull>({
    queryKey: ['installed-app', id],
    queryFn: async () => {
      const res = await fetch(`/api/apps/${id}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
  })

  const uninstallMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/apps/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to uninstall')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installed-apps'] })
      router.push('/home')
    },
  })

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--color-background)]">
        <div className="size-6 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" />
      </div>
    )
  }

  if (!app || !app.manifest) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[var(--color-background)] text-zinc-600">
        <p className="text-sm">App not found</p>
        <button onClick={() => router.push('/home')} className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors">
          <ArrowLeft size={12} /> Back to Home
        </button>
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col">
      {/* App header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-[var(--color-background-panel)] shrink-0 relative">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/home')}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Back"
          >
            <ArrowLeft size={15} />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-300">{app.displayName}</span>
            {app.source === 'sideloaded' && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 uppercase tracking-wider">
                Dev
              </span>
            )}
          </div>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded-lg transition-colors"
            title="Menu"
          >
            <DotsThree size={18} weight="bold" />
          </button>
          {menuOpen && (
            <AppMenu
              app={app}
              onUninstall={() => uninstallMutation.mutate()}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>

      {/* App iframe */}
      <AppFrame
        appId={id}
        manifest={app.manifest}
        userId={null}
        bundlePath={app.bundlePath}
        source={app.source}
        installedAt={app.installedAt}
        className="flex-1 w-full border-0"
      />
    </div>
  )
}
