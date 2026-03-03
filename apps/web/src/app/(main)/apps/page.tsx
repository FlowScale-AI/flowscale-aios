'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import { AppWindow, ArrowRight, Clock, CheckCircle, Warning, Terminal, Copy, Check, X } from 'phosphor-react'

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
        className="relative z-10 w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col gap-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Terminal size={16} className="text-zinc-400" />
            <span className="text-sm font-medium text-zinc-100">cURL — {tool.name}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Description */}
        <p className="px-5 pt-4 text-xs text-zinc-500">
          Execute this tool via HTTP. Image inputs must be sent as a separate{' '}
          <code className="text-zinc-400">multipart/form-data</code> request or omitted to use workflow defaults.
        </p>

        {/* Code block */}
        <div className="relative mx-5 mt-3 mb-5">
          <pre className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-300 font-mono overflow-x-auto whitespace-pre leading-relaxed">
            {curl}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors"
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
            <div className="border-t border-zinc-800 px-5 py-4 space-y-2">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Parameters</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {inputs.map((f) => (
                  <div key={`${f.nodeId}_${f.paramName}`} className="flex items-center gap-2">
                    <code className="text-[11px] text-indigo-300 font-mono bg-indigo-950/40 px-1.5 py-0.5 rounded shrink-0">
                      {f.nodeId}__{f.paramName}
                    </code>
                    <span className="text-[11px] text-zinc-600">{f.paramType}</span>
                    {f.nodeTitle && f.nodeTitle !== f.nodeType && (
                      <span className="text-[11px] text-zinc-700 truncate">· {f.nodeTitle}</span>
                    )}
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
    <div className="group flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-600 hover:bg-zinc-800/50 transition-all duration-150">
      {/* Clickable main area */}
      <Link href={`/apps/${tool.id}`} className="flex flex-col gap-3 p-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center shrink-0">
              <AppWindow size={18} weight="duotone" className="text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white transition-colors">
                {tool.name}
              </h3>
              {tool.version && (
                <span className="text-xs text-zinc-500">v{tool.version}</span>
              )}
            </div>
          </div>
          <ArrowRight
            size={16}
            className="text-zinc-600 group-hover:text-zinc-400 transition-colors mt-1 shrink-0"
          />
        </div>

        {tool.description && (
          <p className="text-sm text-zinc-400 line-clamp-2">{tool.description}</p>
        )}
      </Link>

      {/* Footer: status + cURL button */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <CheckCircle size={13} weight="fill" className="text-emerald-500" />
            <span className="text-xs text-zinc-500">Production</span>
          </div>
          {deployedDate && (
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-zinc-600" />
              <span className="text-xs text-zinc-500">Deployed {deployedDate}</span>
            </div>
          )}
        </div>

        <button
          onClick={onCurlClick}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors"
          title="Copy cURL command"
        >
          <Terminal size={12} />
          cURL
        </button>
      </div>
    </div>
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
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Apps</h1>
            <p className="text-sm text-zinc-500 mt-1">Your deployed production tools</p>
          </div>
          <Link
            href="/build-tool"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + New Tool
          </Link>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-950/30 border border-red-900/50 rounded-xl text-red-400 text-sm">
            <Warning size={16} weight="fill" />
            Failed to load tools. Make sure the server is running.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && tools?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mb-4">
              <AppWindow size={28} weight="duotone" className="text-zinc-500" />
            </div>
            <h2 className="text-base font-medium text-zinc-300 mb-2">No tools deployed yet</h2>
            <p className="text-sm text-zinc-500 mb-6 max-w-xs">
              Go to Build Tool to create and deploy a ComfyUI workflow as a production tool.
            </p>
            <Link
              href="/build-tool"
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Open Build Tool
              <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {/* Grid */}
        {!isLoading && !error && tools && tools.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
