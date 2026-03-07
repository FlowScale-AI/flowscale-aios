'use client'

import Link from 'next/link'
import { ArrowUpRight, Palette } from 'phosphor-react'
import { PageTransition, FadeIn, StaggerGrid, StaggerItem } from '@/components/ui'

// ---------------------------------------------------------------------------
// Tool card
// ---------------------------------------------------------------------------

function CanvasCard() {
  return (
    <div className="group relative h-full">
      <Link href="/canvas" className="block h-full">
        <div className="relative h-full overflow-hidden rounded-lg border border-white/5 bg-[var(--color-background-panel)] p-5 transition-all duration-200 group-hover:border-zinc-700 group-hover:bg-zinc-800/50">
          <div className="relative z-10 flex flex-col gap-3">
            <div className="flex size-10 items-center justify-center rounded-md border border-white/10 bg-white/5 transition-colors duration-200 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20 group-hover:text-emerald-400 text-zinc-400">
              <Palette size={20} weight="duotone" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-tech text-base font-medium text-zinc-100 group-hover:text-white transition-colors">Canvas</h3>
              <p className="text-sm text-zinc-500 line-clamp-2 leading-relaxed">Visual boards for building and arranging your AI workflows.</p>
            </div>
          </div>
          <div className="absolute top-5 right-5 opacity-0 -translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
            <ArrowUpRight size={16} className="text-zinc-400" />
          </div>
        </div>
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AppsPage() {
  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      <div className="flex-1 px-8">
        <div className="space-y-12">

          {/* Hero Section */}
          <FadeIn from="bottom" duration={0.5}>
            <section className="relative flex flex-col items-center justify-center space-y-6 text-center py-16 md:py-24">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />

              <div className="relative z-10 space-y-4 max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-emerald-400 backdrop-blur-md">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  System Operational
                </div>

                <h1 className="font-tech text-4xl md:text-6xl font-bold tracking-tight text-white">
                  Access Your{' '}
                  <span className="bg-gradient-to-r from-emerald-400 to-emerald-200 bg-clip-text text-transparent">
                    Creative Intelligence
                  </span>
                </h1>

                <p className="text-zinc-400 text-lg md:text-xl max-w-xl mx-auto">
                  A unified operating system for all your AI tools. Create, analyze, and build faster than ever.
                </p>
              </div>
            </section>
          </FadeIn>

          {/* Apps Grid */}
          <section>
            <FadeIn delay={0.15}>
              <h2 className="font-tech text-2xl font-semibold text-white mb-6">Apps</h2>
            </FadeIn>

            <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              <StaggerItem key="canvas">
                <CanvasCard />
              </StaggerItem>
            </StaggerGrid>
          </section>

        </div>
      </div>
    </PageTransition>
  )
}
