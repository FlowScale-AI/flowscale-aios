import { useState } from 'react'
import type { ToolDefinition } from '../types'

interface Props {
  tools: ToolDefinition[]
  loading: boolean
  selectedId: string | null
  onSelect: (tool: ToolDefinition) => void
}

export function ToolList({ tools, loading, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('')

  const filtered = tools.filter(
    (t) =>
      t.name.toLowerCase().includes(query.toLowerCase()) ||
      t.description?.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-950 h-full">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Tools</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-zinc-900 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-8">
            {tools.length === 0 ? 'No production tools found.' : 'No results.'}
          </p>
        )}

        {!loading && filtered.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onSelect(tool)}
            className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors group ${
              selectedId === tool.id
                ? 'bg-emerald-500/10 border border-emerald-500/20'
                : 'hover:bg-zinc-900 border border-transparent'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm font-medium truncate ${selectedId === tool.id ? 'text-emerald-400' : 'text-zinc-200'}`}>
                {tool.name}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 shrink-0">
                {tool.engine}
              </span>
            </div>
            {tool.description && (
              <p className="text-xs text-zinc-500 truncate mt-0.5">{tool.description}</p>
            )}
          </button>
        ))}
      </div>
    </aside>
  )
}
