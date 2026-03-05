'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  AppWindow,
  GearSix,
  ImageSquare,
  Infinity as InfinityIcon,
  Users,
  SignOut,
  Plugs,
  Compass,
} from 'phosphor-react'
import type { Role } from '@/lib/auth'

const ALL_NAV_ITEMS = [
  { href: '/apps', icon: AppWindow, label: 'Apps' },
  { href: '/outputs', icon: ImageSquare, label: 'Assets' },
  { href: '/integrations', icon: Plugs, label: 'Integrations' },
  { href: '/explore', icon: Compass, label: 'Explore' },
  { href: '/users', icon: Users, label: 'Users' },
  { href: '/settings', icon: GearSix, label: 'Settings' },
]

const ROLE_PATHS: Record<Role, string[]> = {
  admin: ['/apps', '/outputs', '/integrations', '/explore', '/users', '/settings'],
  pipeline_td: ['/apps', '/outputs', '/integrations', '/explore', '/users', '/settings'],
  dev: ['/apps', '/outputs', '/integrations', '/explore', '/settings'],
  artist: ['/apps', '/outputs', '/explore'],
}

export default function Sidebar({ role, username }: { role: Role; username: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const allowed = ROLE_PATHS[role] ?? ROLE_PATHS['artist']
  const navItems = ALL_NAV_ITEMS.filter((item) => allowed.includes(item.href))

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <nav className="group/sidebar relative flex flex-col bg-[var(--color-background-panel)] border-r border-white/5 transition-all duration-200 ease-in-out w-16 hover:w-[220px] hover:shadow-2xl hover:shadow-black/50 shrink-0 overflow-hidden z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 py-5 border-b border-white/5 shrink-0">
        <div className="size-10 rounded-xl bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
          <InfinityIcon size={24} weight="bold" className="text-emerald-500" />
        </div>
        <span className="font-tech text-lg font-bold tracking-tight text-white whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75">
          FlowScale
        </span>
      </div>

      {/* Nav links */}
      <div className="flex flex-col gap-1 p-2 flex-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-150',
                'whitespace-nowrap group/item',
                active
                  ? 'bg-white/5 text-emerald-400'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
              ].join(' ')}
            >
              <Icon
                size={20}
                weight={active ? 'fill' : 'regular'}
                className="shrink-0 transition-transform group-hover/item:scale-110"
              />
              <span className="text-sm font-medium opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75">
                {label}
              </span>
            </Link>
          )
        })}
      </div>

      {/* Footer: user + logout */}
      <div className="p-2 border-t border-white/5 shrink-0">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="size-7 rounded-full bg-zinc-800 border border-white/10 shrink-0 flex items-center justify-center">
            <span className="text-[10px] text-zinc-300 font-medium uppercase">
              {username.slice(0, 2)}
            </span>
          </div>
          <span className="text-xs text-zinc-400 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 whitespace-nowrap flex-1 truncate">
            {username}
          </span>
          <button
            onClick={handleLogout}
            className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 text-zinc-500 hover:text-red-400 shrink-0"
            title="Sign out"
          >
            <SignOut size={15} />
          </button>
        </div>
      </div>
    </nav>
  )
}
