'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ArrowClockwise,
  CheckCircle,
  Warning,
  X,
} from 'phosphor-react'
import { ComfyLogsPanel } from '@/components/ComfyLogsPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

type ComfyInstance = { port: number; systemStats: Record<string, unknown> | null }

type SysInfo = {
  system?: {
    comfyui_version?: string
    python_version?: string
    pytorch_version?: string
    os?: string
    ram_total?: number
    ram_free?: number
  }
  devices?: Array<{
    name?: string
    type?: string
    vram_total?: number
    vram_free?: number
    torch_vram_total?: number
    torch_vram_free?: number
  }>
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(bytes?: number) {
  if (!bytes) return '—'
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB'
  return bytes + ' B'
}



// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'models' | 'custom-nodes' | 'logs'

export default function ComfyUIPage() {
  const [instance, setInstance] = useState<ComfyInstance | null>(null)
  const [scanning, setScanning] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/comfy/scan')
      const data: ComfyInstance[] = await res.json()
      setInstance(data.length > 0 ? data[0] : null)
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => { scan() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const stats = instance?.systemStats as SysInfo | null

  if (!instance) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
        {scanning ? (
          <>
            <ArrowClockwise size={40} className="animate-spin" />
            <p className="text-sm">Scanning for ComfyUI…</p>
          </>
        ) : (
          <>
            <Warning size={40} />
            <p className="text-sm">No running ComfyUI instance found</p>
            <button
              onClick={scan}
              className="mt-1 px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded-lg transition-colors"
            >
              Refresh
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <CheckCircle size={16} weight="fill" className="text-emerald-400" />
          <span className="text-white font-medium">127.0.0.1:{instance.port}</span>
        </div>
        <span className="text-zinc-600 text-sm">
          {stats?.system?.comfyui_version ?? ''}
        </span>
        <button
          onClick={scan}
          disabled={scanning}
          className="ml-auto text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <ArrowClockwise size={15} className={scanning ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-3 shrink-0">
        {(['overview', 'models', 'custom-nodes', 'logs'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize',
              tab === t ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {t === 'custom-nodes' ? 'Custom Nodes' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {tab === 'overview' && <OverviewTab stats={stats} />}
        {tab === 'models' && <ModelsTab port={instance.port} />}
        {tab === 'custom-nodes' && <CustomNodesTab port={instance.port} />}
        {tab === 'logs' && <LogsTab port={instance.port} />}
      </div>
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: SysInfo | null }) {
  if (!stats) return <p className="text-zinc-500 text-sm">No data available</p>

  const sys = stats.system
  const devices = stats.devices ?? []

  return (
    <div className="space-y-6 max-w-2xl">
      <Section title="Version">
        <Grid>
          <Stat label="ComfyUI" value={sys?.comfyui_version ?? '—'} />
          <Stat label="Python" value={sys?.python_version?.split(' ')[0] ?? '—'} />
          <Stat label="PyTorch" value={sys?.pytorch_version ?? '—'} />
          <Stat label="OS" value={sys?.os ?? '—'} />
        </Grid>
      </Section>

      <Section title="Memory">
        <Grid>
          <Stat label="RAM Total" value={fmt(sys?.ram_total)} />
          <Stat label="RAM Free" value={fmt(sys?.ram_free)} />
        </Grid>
      </Section>

      {devices.length > 0 && (
        <Section title="Devices">
          <div className="space-y-3">
            {devices.map((d, i) => (
              <div key={i} className="bg-white/5 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-white font-medium text-sm">{d.name ?? 'Unknown'}</span>
                  <span className="text-xs text-zinc-500 bg-white/5 px-2 py-0.5 rounded">
                    {d.type?.toUpperCase() ?? 'CPU'}
                  </span>
                </div>
                <Grid>
                  <Stat label="VRAM Total" value={fmt(d.vram_total)} />
                  <Stat label="VRAM Free" value={fmt(d.vram_free)} />
                  <Stat label="Torch VRAM Total" value={fmt(d.torch_vram_total)} />
                  <Stat label="Torch VRAM Free" value={fmt(d.torch_vram_free)} />
                </Grid>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// ─── Models ───────────────────────────────────────────────────────────────────

const SKIP_MODEL_TYPES = new Set(['configs', 'custom_nodes', 'classifiers'])

function ModelsTab({ port }: { port: number }) {
  const [groups, setGroups] = useState<Record<string, string[]> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const typesRes = await fetch(`/api/comfy/${port}/models`)
        const types: string[] = await typesRes.json()
        const relevant = types.filter((t) => !SKIP_MODEL_TYPES.has(t))
        const results = await Promise.all(
          relevant.map((t) =>
            fetch(`/api/comfy/${port}/models/${t}`)
              .then((r) => r.json() as Promise<string[]>)
              .then((files) => [t, files] as [string, string[]])
              .catch(() => [t, []] as [string, string[]])
          )
        )
        const g: Record<string, string[]> = {}
        for (const [t, files] of results) {
          if (files.length > 0) g[t] = files
        }
        setGroups(g)
      } catch {
        setError('Failed to load models')
      } finally {
        setLoading(false)
      }
    })()
  }, [port])

  if (loading) return <Spinner />
  if (error) return <ErrorMsg msg={error} />

  const entries = Object.entries(groups ?? {}).filter(([, v]) => v.length > 0)

  if (entries.length === 0)
    return <p className="text-zinc-500 text-sm">No models found</p>

  return (
    <div className="space-y-5 max-w-2xl">
      {entries.map(([label, files]) => (
        <Section key={label} title={`${label} (${files.length})`}>
          <div className="space-y-1">
            {files.map((f) => (
              <div key={f} className="text-sm text-zinc-300 font-mono bg-white/5 px-3 py-1.5 rounded-lg truncate">
                {f}
              </div>
            ))}
          </div>
        </Section>
      ))}
    </div>
  )
}

// ─── Custom Nodes ─────────────────────────────────────────────────────────────

type NodeEntry = { name: string; type: 'file' | 'folder' }

function CustomNodesTab({ port }: { port: number }) {
  const [nodes, setNodes] = useState<NodeEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(`/api/comfy/${port}/custom-nodes`)
      .then((r) => r.json())
      .then((data: { nodes: NodeEntry[]; error?: string }) => {
        if (data.error && !data.nodes.length) setError(data.error)
        else setNodes(data.nodes)
      })
      .catch(() => setError('Failed to load custom nodes'))
      .finally(() => setLoading(false))
  }, [port])

  if (loading) return <Spinner />
  if (error) return <ErrorMsg msg={error} />
  if (!nodes?.length) return <p className="text-zinc-500 text-sm">No custom nodes detected</p>

  return (
    <div className="space-y-2 max-w-2xl">
      <p className="text-xs text-zinc-500 mb-3">{nodes.length} package{nodes.length !== 1 ? 's' : ''} installed</p>
      {nodes.map((n) => (
        <div key={n.name} className="flex items-center gap-3 bg-white/5 px-4 py-2.5 rounded-xl">
          <div className={`size-2 rounded-full shrink-0 ${n.type === 'folder' ? 'bg-emerald-500/60' : 'bg-zinc-500/60'}`} />
          <span className="text-sm text-zinc-200 font-mono">{n.name}</span>
          {n.type === 'file' && <span className="text-xs text-zinc-600 ml-auto">.py</span>}
        </div>
      ))}
    </div>
  )
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

function LogsTab({ port }: { port: number }) {
  return <ComfyLogsPanel port={port} />
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-xl px-4 py-3">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className="text-sm text-white font-mono truncate">{value}</div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 text-zinc-500 text-sm py-4">
      <ArrowClockwise size={14} className="animate-spin" /> Loading…
    </div>
  )
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
      <X size={14} /> {msg}
    </div>
  )
}
