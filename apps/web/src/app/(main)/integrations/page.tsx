'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'phosphor-react'
import { PageTransition, FadeIn } from '@/components/ui'

const INTEGRATIONS = [
  {
    href: '/integrations/comfyui',
    logo: '/comfyui-logo.png',
    label: 'ComfyUI',
    description: 'Connect to a local ComfyUI instance. Build tools, browse models, manage custom nodes, and view logs.',
  },
]

const COMING_SOON = [
  {
    logo: 'https://huggingface.co/front/assets/huggingface_logo-noborder.svg',
    label: 'Hugging Face',
    description: 'Browse and deploy models directly from Hugging Face Hub. Run inference pipelines locally or in the cloud.',
  },
  {
    logo: '/openai-logo.svg',
    label: 'OpenAI',
    description: 'Integrate GPT and DALL·E models into your workflows for text generation, image creation, and more.',
  },
  {
    logo: 'https://cdn.simpleicons.org/replicate/white',
    label: 'Replicate',
    description: 'Run open-source models in the cloud via Replicate. Deploy predictions with a single API call.',
  },
  {
    logo: '/fal-logo.svg',
    label: 'fal.ai',
    description: 'Run generative AI models on fal.ai serverless infrastructure with fast cold starts and auto-scaling.',
  },
  {
    logo: 'https://openrouter.ai/favicon.ico',
    label: 'OpenRouter',
    description: 'Access hundreds of LLMs through a single API. Route requests to the best model for cost, speed, or quality.',
  },
]

export default function IntegrationsPage() {
  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      <div className="flex-1 px-8 py-10">
        <FadeIn from="bottom" duration={0.4}>
          <div className="mb-10">
            <h1 className="font-tech text-3xl font-bold text-white mb-2">Integrations</h1>
            <p className="text-zinc-400 text-base">Connect FlowScale to external tools and services.</p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {INTEGRATIONS.map(({ href, logo, label, description }) => (
              <Link key={href} href={href} className="group">
                <div className="relative overflow-hidden rounded-xl border border-white/5 bg-[var(--color-background-panel)] p-6 transition-all duration-200 group-hover:border-zinc-700 group-hover:bg-zinc-800/50 h-full">
                  <div className="flex items-start gap-4">
                    <div className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 overflow-hidden shrink-0">
                      <img src={logo} alt={label} className="size-8 object-contain" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <h3 className="font-tech text-base font-semibold text-zinc-100 group-hover:text-white transition-colors">
                          {label}
                        </h3>
                      </div>
                      <p className="text-sm text-zinc-500 leading-relaxed">{description}</p>
                    </div>
                  </div>
                  <div className="absolute top-5 right-5 opacity-0 -translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
                    <ArrowUpRight size={16} className="text-zinc-400" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </FadeIn>

        <FadeIn delay={0.2}>
          <div className="mt-12 mb-6">
            <h2 className="font-tech text-lg font-semibold text-zinc-400 mb-1">Coming Soon</h2>
            <p className="text-sm text-zinc-600">These integrations are on the roadmap.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {COMING_SOON.map(({ logo, label, description }) => (
              <div key={label} className="relative overflow-hidden rounded-xl border border-white/5 bg-[var(--color-background-panel)] p-6 opacity-50">
                <div className="flex items-start gap-4">
                  <div className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 overflow-hidden shrink-0">
                    <img src={logo} alt={label} className="size-7 object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <h3 className="font-tech text-base font-semibold text-zinc-100">{label}</h3>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-500 font-medium">soon</span>
                    </div>
                    <p className="text-sm text-zinc-500 leading-relaxed">{description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </PageTransition>
  )
}
