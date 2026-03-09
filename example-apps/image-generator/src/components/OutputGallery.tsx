import type { ToolOutputItem } from '../types'

interface Props {
  outputs: ToolOutputItem[]
  running: boolean
}

export function OutputGallery({ outputs, running }: Props) {
  if (running) {
    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-zinc-400">Running…</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="aspect-square rounded-xl bg-zinc-900 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (outputs.length === 0) return null

  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
        Outputs
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {outputs.map((item, i) => (
          <OutputItem key={i} item={item} />
        ))}
      </div>
    </div>
  )
}

function OutputItem({ item }: { item: ToolOutputItem }) {
  if (item.kind === 'image') {
    return (
      <a href={item.path} target="_blank" rel="noreferrer" className="group block">
        <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
          <img
            src={item.path}
            alt={item.filename}
            className="w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <svg className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
        </div>
        <p className="text-xs text-zinc-600 mt-1 truncate">{item.filename}</p>
      </a>
    )
  }

  if (item.kind === 'video') {
    return (
      <div className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <video src={item.path} controls className="w-full" />
        <p className="text-xs text-zinc-600 p-2 truncate">{item.filename}</p>
      </div>
    )
  }

  if (item.kind === 'audio') {
    return (
      <div className="rounded-xl p-3 bg-zinc-900 border border-zinc-800 col-span-2">
        <p className="text-xs text-zinc-500 mb-2 truncate">{item.filename}</p>
        <audio src={item.path} controls className="w-full" />
      </div>
    )
  }

  return (
    <a
      href={item.path}
      download={item.filename}
      className="flex items-center gap-3 rounded-xl p-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors col-span-2"
    >
      <svg className="w-5 h-5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="text-sm text-zinc-300 truncate">{item.filename}</span>
    </a>
  )
}
