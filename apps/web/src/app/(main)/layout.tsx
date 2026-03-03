'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  AppWindow,
  Wrench,
  Palette,
  GearSix,
  FlowArrow,
} from 'phosphor-react'
import type { ReactNode } from 'react'
import { CanvasStateProvider } from '@/features/canvases/components/CanvasStateContext'

const NAV_ITEMS = [
  { href: '/apps', icon: AppWindow, label: 'Apps' },
  { href: '/build-tool', icon: Wrench, label: 'Build Tool' },
  { href: '/canvas', icon: Palette, label: 'Canvas' },
  { href: '/settings', icon: GearSix, label: 'Settings' },
]

export default function MainLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      {/* Sidebar */}
      <nav className="group/sidebar relative flex flex-col bg-[var(--color-background-panel)] border-r border-white/5 transition-all duration-200 ease-in-out w-16 hover:w-[220px] hover:shadow-2xl hover:shadow-black/50 shrink-0 overflow-hidden z-50">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/5 shrink-0">
          <FlowArrow size={28} weight="duotone" className="text-emerald-400 shrink-0" />
          <span className="font-tech text-sm font-semibold text-zinc-100 whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75">
            FlowScale AI OS
          </span>
        </div>

        {/* Nav links */}
        <div className="flex flex-col gap-1 p-2 flex-1">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
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

        {/* Version badge */}
        <div className="p-2 border-t border-white/5 shrink-0">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-5 h-5 rounded-full bg-zinc-800 shrink-0 flex items-center justify-center">
              <span className="text-[9px] text-zinc-500 font-mono-custom">v1</span>
            </div>
            <span className="text-xs text-zinc-600 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 whitespace-nowrap font-mono-custom">
              v0.1.0
            </span>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <CanvasStateProvider>{children}</CanvasStateProvider>
      </main>
    </div>
  )
}
