'use client'

import { Compass } from 'phosphor-react'
import { PageTransition, FadeIn } from '@/components/ui'

const COMING_SOON_APPS = [
  {
    title: 'AI Storyboarding',
    description: 'Generate cinematic storyboards from text prompts. Plan shots, scenes, and visual narratives with AI-powered illustration.',
    category: 'Creative',
    color: 'emerald',
  },
  {
    title: '3D Asset Designer',
    description: 'Create and iterate on 3D models, textures, and materials using generative AI. Export to industry-standard formats.',
    category: 'Production',
    color: 'violet',
  },
  {
    title: 'Texture Generator',
    description: 'Generate seamless PBR textures from text or reference images. Create tileable materials for 3D environments.',
    category: 'Production',
    color: 'amber',
  },
  {
    title: 'Motion Capture Studio',
    description: 'Extract motion data from video references. Retarget animations to 3D characters with AI-assisted cleanup.',
    category: 'Animation',
    color: 'sky',
  },
  {
    title: 'Concept Art Generator',
    description: 'Rapidly explore visual directions for characters, environments, and props. Maintain style consistency across iterations.',
    category: 'Creative',
    color: 'rose',
  },
  {
    title: 'Audio Designer',
    description: 'Generate sound effects, ambient soundscapes, and voice-overs. Mix and layer AI-generated audio for production.',
    category: 'Audio',
    color: 'orange',
  },
  {
    title: 'AI Video Editor',
    description: 'Automate rough cuts, color grading, and transitions. Use AI to match edits to music tempo and scene mood.',
    category: 'Post-Production',
    color: 'cyan',
  },
  {
    title: 'Character Pipeline',
    description: 'End-to-end character creation from concept to rigged 3D model. Consistent design across turnarounds and poses.',
    category: 'Production',
    color: 'fuchsia',
  },
]

const COLOR_MAP: Record<string, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  sky: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  fuchsia: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20',
}

export default function ExplorePage() {
  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      <div className="flex-1 px-8 py-10">
        <FadeIn from="bottom" duration={0.4}>
          <div className="mb-10">
            <h1 className="font-tech text-3xl font-bold text-white mb-2">Explore</h1>
            <p className="text-zinc-400 text-base">Upcoming apps and experiences coming to FlowScale.</p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {COMING_SOON_APPS.map(({ title, description, category, color }) => (
              <div
                key={title}
                className="relative overflow-hidden rounded-xl border border-white/5 bg-[var(--color-background-panel)] p-6 transition-all duration-200 hover:border-zinc-700/50"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className={`size-9 rounded-lg border flex items-center justify-center shrink-0 ${COLOR_MAP[color]}`}>
                    <Compass size={18} weight="duotone" />
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-500 font-medium">soon</span>
                </div>
                <h3 className="font-tech text-sm font-semibold text-zinc-200 mb-1.5">{title}</h3>
                <p className="text-xs text-zinc-500 leading-relaxed mb-3">{description}</p>
                <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">{category}</span>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </PageTransition>
  )
}
