import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useTools } from './hooks/useTools'
import { LoginForm } from './components/LoginForm'
import { ToolList } from './components/ToolList'
import { ToolRunner } from './components/ToolRunner'
import type { ToolDefinition } from './types'

export function App() {
  const { auth, login, logout } = useAuth()
  const [selectedTool, setSelectedTool] = useState<ToolDefinition | null>(null)

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

  return <MainLayout user={auth.user} selectedTool={selectedTool} onSelectTool={setSelectedTool} onLogout={logout} />
}

function MainLayout({
  user,
  selectedTool,
  onSelectTool,
  onLogout,
}: {
  user: { username: string }
  selectedTool: ToolDefinition | null
  onSelectTool: (tool: ToolDefinition) => void
  onLogout: () => void
}) {
  const { tools, loading } = useTools()

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
          <span className="text-sm font-medium text-zinc-200">FlowScale Image Generator</span>
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
      <div className="flex-1 flex overflow-hidden">
        <ToolList
          tools={tools}
          loading={loading}
          selectedId={selectedTool?.id ?? null}
          onSelect={onSelectTool}
        />

        <main className="flex-1 overflow-y-auto">
          {selectedTool ? (
            <ToolRunner key={selectedTool.id} tool={selectedTool} />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <svg className="mx-auto w-10 h-10 text-zinc-800 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-sm text-zinc-600">Select a tool to get started</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
