'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  House,
  Wrench,
  Plugs,
  Storefront,
  GearSix,
  SignOut,
  Infinity as InfinityIcon,
  Cube,
} from 'phosphor-react'
import type { Role } from '@/lib/auth'

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pt-3 pb-0.5">
      <span className="text-[9px] font-semibold tracking-widest text-zinc-600 uppercase opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 whitespace-nowrap block">
        {label}
      </span>
      <div className="border-t border-white/5 mt-1 group-hover/sidebar:opacity-0 transition-opacity duration-150" />
    </div>
  )
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  badge,
}: {
  href: string
  icon: React.ElementType
  label: string
  active: boolean
  badge?: string
}) {
  return (
    <Link
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
      <span className="text-sm font-medium opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 flex-1">
        {label}
      </span>
      {badge && (
        <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 uppercase tracking-wider shrink-0">
          {badge}
        </span>
      )}
    </Link>
  )
}

export default function Sidebar({ role, username }: { role: Role; username: string }) {
  const pathname = usePathname()
  const router = useRouter()

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

      {/* Nav */}
      <div className="flex flex-col gap-0.5 p-2 flex-1 overflow-y-auto overflow-x-hidden">

        {/* Home */}
        <NavItem href="/home" icon={House} label="Home" active={pathname === '/home'} />

        {/* APPS */}
        <SectionLabel label="Apps" />

        <NavItem
          href="/apps"
          icon={Cube}
          label="Apps"
          active={pathname === '/apps' || pathname.startsWith('/apps/') || pathname.startsWith('/installed-apps/')}
        />

        {/* TOOLS */}
        <SectionLabel label="Tools" />
        <NavItem
          href="/tools"
          icon={Wrench}
          label="Tools"
          active={pathname === '/tools' || pathname.startsWith('/tools/')}
        />

        {/* INFRASTRUCTURE */}
        <SectionLabel label="Infrastructure" />
        <NavItem
          href="/providers"
          icon={Plugs}
          label="Providers"
          active={pathname === '/providers' || pathname.startsWith('/providers/')}
        />

        {/* DISCOVER */}
        <SectionLabel label="Discover" />
        <NavItem
          href="/explore"
          icon={Storefront}
          label="App Store"
          active={pathname === '/explore' || pathname.startsWith('/explore/')}
        />

      </div>

      {/* Footer */}
      <div className="p-2 border-t border-white/5 shrink-0">
        <NavItem
          href="/settings"
          icon={GearSix}
          label="Settings"
          active={pathname === '/settings'}
        />
        <div className="flex items-center gap-3 px-3 py-2 mt-1">
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
