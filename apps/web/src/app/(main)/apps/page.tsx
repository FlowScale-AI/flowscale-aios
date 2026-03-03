'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import { AppWindow, ArrowRight, Warning, Terminal, Copy, Check, X } from 'phosphor-react'

interface WorkflowIO {
  nodeId: string
  nodeType: string
  nodeTitle: string
  paramName: string
  paramType: 'string' | 'number' | 'boolean' | 'image' | 'select'
  defaultValue?: unknown
  options?: string[]
  isInput: boolean
}

interface Tool {
  id: string
  name: string
  description: string | null
  status: string
  schemaJson: string | null
  version: number | null
  deployedAt: number | null
  createdAt: number
}

// ---------------------------------------------------------------------------
// cURL generation
// ---------------------------------------------------------------------------

function buildCurlCommand(toolId: string, schemaJson: string | null): string {
  let schema: WorkflowIO[] = []
  try { if (schemaJson) schema = JSON.parse(schemaJson) } catch { /* ignore */ }

  const inputs: Record<string, unknown> = {}
  for (const field of schema) {
    if (!field.isInput || field.paramType === 'image') continue
    const key = `${field.nodeId}__${field.paramName}`
    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      inputs[key] = field.defaultValue
    } else {
      inputs[key] = field.paramType === 'number' ? 0
        : field.paramType === 'boolean' ? false
        : field.paramType === 'select' ? (field.options?.[0] ?? '')
        : ''
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:14173'
  const body = JSON.stringify({ inputs }, null, 2)
  return `curl -X POST ${origin}/api/tools/${toolId}/executions \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
}

// ---------------------------------------------------------------------------
// cURL modal
// ---------------------------------------------------------------------------

function CurlModal({ tool, onClose }: { tool: Tool; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const curl = buildCurlCommand(tool.id, tool.schemaJson)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(curl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [curl])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-2xl bg-zinc-950 border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col gap-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <Terminal size={16} className="text-zinc-400" />
            <span className="text-sm font-medium text-zinc-100">{tool.name}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Description */}
        <p className="px-5 pt-4 text-xs text-zinc-500">
          Execute this tool via HTTP. Image inputs must be sent as a separate{' '}
          <code className="text-zinc-400 font-mono-custom">multipart/form-data</code> request or omitted to use workflow defaults.
        </p>

        {/* Code block */}
        <div className="relative mx-5 mt-3 mb-5">
          <pre className="bg-zinc-900 border border-white/5 rounded-lg p-4 text-xs text-zinc-300 font-mono-custom overflow-x-auto whitespace-pre leading-relaxed">
            {curl}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors"
          >
            {copied ? (
              <>
                <Check size={12} className="text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                Copy
              </>
            )}
          </button>
        </div>

        {/* Input legend */}
        {tool.schemaJson && (() => {
          let schema: WorkflowIO[] = []
          try { schema = JSON.parse(tool.schemaJson) } catch { return null }
          const inputs = schema.filter((f) => f.isInput && f.paramType !== 'image')
          if (inputs.length === 0) return null
          return (
            <div className="border-t border-white/5 px-5 py-4 space-y-2">
              <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest font-mono-custom mb-3">Parameters</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {inputs.map((f) => (
                  <div key={`${f.nodeId}_${f.paramName}`} className="flex items-center gap-2">
                    <code className="text-[11px] text-emerald-300 font-mono-custom bg-emerald-950/40 px-1.5 py-0.5 rounded shrink-0">
                      {f.nodeId}__{f.paramName}
                    </code>
                    <span className="text-[11px] text-zinc-600 font-mono-custom">{f.paramType}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool card
// ---------------------------------------------------------------------------

function ToolCard({ tool, onCurlClick }: { tool: Tool; onCurlClick: () => void }) {
  const deployedDate = tool.deployedAt
    ? new Date(tool.deployedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <Link
      href={`/apps/${tool.id}`}
      className="group relative flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 hover:bg-zinc-900 hover:border-emerald-500/30 hover:shadow-xl hover:shadow-emerald-900/10 hover:-translate-y-1 transition-all duration-200"
    >
      {/* Preview surface */}
      <div className="relative h-36 bg-[var(--color-background-canvas)] overflow-hidden bg-grid-pattern">
        <div className="absolute inset-0 flex items-center justify-center">
          <AppWindow
            size={32}
            weight="duotone"
            className="text-zinc-700 group-hover:text-emerald-500 transition-colors"
          />
        </div>

        {/* Status dot */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-900/80 backdrop-blur-md border border-white/10">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] text-zinc-400">Production</span>
        </div>

        {/* cURL button */}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.preventDefault(); onCurlClick() }}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-900/80 backdrop-blur-md border border-white/10 text-zinc-400 hover:text-white text-[10px] font-medium transition-colors"
          >
            <Terminal size={10} />
            cURL
          </button>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#18181b] to-transparent" />
      </div>

      {/* Card footer */}
      <div className="px-4 py-3 flex items-center justify-between gap-2 bg-[#18181b]">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{tool.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {tool.version && (
              <span className="text-xs text-zinc-600 font-mono-custom">v{tool.version}</span>
            )}
            {deployedDate && (
              <span className="text-xs text-zinc-600 font-mono-custom">{deployedDate}</span>
            )}
          </div>
        </div>
        <AppWindow size={16} className="text-zinc-600 shrink-0" />
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AppsPage() {
  const [curlTool, setCurlTool] = useState<Tool | null>(null)

  const { data: tools, isLoading, error } = useQuery<Tool[]>({
    queryKey: ['tools', 'production'],
    queryFn: async () => {
      const res = await fetch('/api/tools?status=production')
      if (!res.ok) throw new Error('Failed to fetch tools')
      return res.json()
    },
  })

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
        <div>
          <h1 className="font-tech text-xl font-semibold text-zinc-100">Apps</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Your deployed production tools</p>
        </div>
        <Link
          href="/build-tool"
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md transition-colors"
        >
          + New Tool
        </Link>
      </div>

      <div className="flex-1 p-8">

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-40 bg-zinc-900/50 border border-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-950/30 border border-red-900/50 rounded-lg text-red-400 text-sm">
            <Warning size={16} weight="fill" />
            Failed to load tools. Make sure the server is running.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && tools?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center mb-4">
              <AppWindow size={28} weight="duotone" className="text-zinc-600" />
            </div>
            <h2 className="font-tech text-base font-medium text-zinc-300 mb-2">No tools deployed yet</h2>
            <p className="text-sm text-zinc-500 mb-6 max-w-xs">
              Go to Build Tool to create and deploy a ComfyUI workflow as a production tool.
            </p>
            <Link
              href="/build-tool"
              className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md transition-colors"
            >
              Open Build Tool
              <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {/* Grid */}
        {!isLoading && !error && tools && tools.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onCurlClick={() => setCurlTool(tool)} />
            ))}
          </div>
        )}
      </div>

      {/* cURL modal */}
      {curlTool && (
        <CurlModal tool={curlTool} onClose={() => setCurlTool(null)} />
      )}
    </div>
  )
}
