import { useState, useEffect } from 'react'
import { useAuth } from './hooks/useAuth'
import { LoginForm } from './components/LoginForm'
import { PipelineRunner } from './components/PipelineRunner'
import { apiClient } from './api/client'
import type { ToolDefinition } from './types'

// Tool name matching — case-insensitive substring search
const GEN_TOOL_PATTERN = /gemini/i
const RESIZE_TOOL_PATTERN = /resize/i

export function App() {
  const { auth, login, logout } = useAuth()

  if (auth.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (auth.status === 'unauthenticated') {
    return <LoginForm onLogin={login} />
  }

  return <Main user={auth.user} onLogout={logout} />
}

function Main({ user, onLogout }: { user: { username: string }; onLogout: () => void }) {
  const [genTool, setGenTool] = useState<ToolDefinition | null>(null)
  const [resizeTool, setResizeTool] = useState<ToolDefinition | null>(null)
  const [loadingTools, setLoadingTools] = useState(true)
  const [toolError, setToolError] = useState<string | null>(null)

  useEffect(() => {
    setLoadingTools(true)
    apiClient.listTools()
      .then((tools) => {
        const gen = tools.find((t) => GEN_TOOL_PATTERN.test(t.name)) ?? null
        const resize = tools.find((t) => RESIZE_TOOL_PATTERN.test(t.name)) ?? null
        setGenTool(gen)
        setResizeTool(resize)
        if (!gen || !resize) {
          const missing: string[] = []
          if (!gen) missing.push('"gemini" image generation tool')
          if (!resize) missing.push('"resize" image tool')
          setToolError(`Could not find production tools: ${missing.join(', ')}. Make sure they are deployed in FlowScale.`)
        }
      })
      .catch((err: Error) => setToolError(err.message))
      .finally(() => setLoadingTools(false))
  }, [])

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-sm font-medium text-zinc-200">Image Gen & Resize</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">{user.username}</span>
          <button
            onClick={onLogout}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loadingTools ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : toolError ? (
          <div className="max-w-2xl mx-auto p-6">
            <div className="px-4 py-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <p className="font-medium mb-1">Tools not found</p>
              <p className="text-red-400/80">{toolError}</p>
            </div>
            <ToolList genTool={genTool} resizeTool={resizeTool} />
          </div>
        ) : genTool && resizeTool ? (
          <PipelineRunner genTool={genTool} resizeTool={resizeTool} />
        ) : null}
      </div>
    </div>
  )
}

function ToolList({
  genTool,
  resizeTool,
}: {
  genTool: ToolDefinition | null
  resizeTool: ToolDefinition | null
}) {
  return (
    <div className="mt-4 space-y-2">
      <ToolStatus label='Gemini image generation tool (name must contain "gemini")' found={!!genTool} tool={genTool} />
      <ToolStatus label='Image resize tool (name must contain "resize")' found={!!resizeTool} tool={resizeTool} />
    </div>
  )
}

function ToolStatus({
  label,
  found,
  tool,
}: {
  label: string
  found: boolean
  tool: ToolDefinition | null
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${found ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900'}`}>
      <div className={`w-2 h-2 rounded-full shrink-0 ${found ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
      <div className="min-w-0">
        <p className="text-xs text-zinc-400">{label}</p>
        {tool && <p className="text-xs text-zinc-200 mt-0.5 truncate">{tool.name}</p>}
      </div>
    </div>
  )
}
