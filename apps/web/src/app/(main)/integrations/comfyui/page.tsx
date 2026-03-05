'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowClockwise,
  CheckCircle,
  Flask as FlaskConical,
  Gear,
  Plus,
  RocketLaunch,
  Warning,
  Wrench,
  X,
} from 'phosphor-react'
import { ComfyLogsPanel } from '@/components/ComfyLogsPanel'
import { ToolTestPlayground } from '@/components/ToolTestPlayground'

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

type Tab = 'overview' | 'tools' | 'models' | 'custom-nodes' | 'logs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tools', label: 'Tools' },
  { id: 'models', label: 'Models' },
  { id: 'custom-nodes', label: 'Custom Nodes' },
  { id: 'logs', label: 'Logs' },
]

export default function ComfyUIIntegrationPage() {
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        {scanning ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <ArrowClockwise size={14} className="animate-spin" />
            Scanning for ComfyUI…
          </div>
        ) : instance ? (
          <>
            <div className="flex items-center gap-2">
              <CheckCircle size={16} weight="fill" className="text-emerald-400" />
              <span className="text-white font-medium">127.0.0.1:{instance.port}</span>
            </div>
            <span className="text-zinc-600 text-sm">
              {stats?.system?.comfyui_version ?? ''}
            </span>
          </>
        ) : (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <Warning size={14} />
            No running ComfyUI instance found
          </div>
        )}
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
      <div className="flex gap-1 px-6 pt-3 shrink-0 border-b border-white/5 pb-0">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={[
              'px-3 py-2 rounded-t-lg text-sm font-medium transition-colors -mb-px border-b-2',
              tab === id
                ? 'text-white border-emerald-500'
                : 'text-zinc-500 hover:text-zinc-300 border-transparent',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={['flex-1', tab === 'tools' ? 'overflow-hidden' : 'overflow-y-auto px-6 py-4'].join(' ')}>
        {tab === 'overview' && (
          instance
            ? <OverviewTab stats={stats} />
            : <NoInstance onRefresh={scan} scanning={scanning} />
        )}
        {tab === 'tools' && <ToolsTab />}
        {tab === 'models' && (
          instance
            ? <ModelsTab port={instance.port} />
            : <NoInstance onRefresh={scan} scanning={scanning} />
        )}
        {tab === 'custom-nodes' && (
          instance
            ? <CustomNodesTab port={instance.port} />
            : <NoInstance onRefresh={scan} scanning={scanning} />
        )}
        {tab === 'logs' && (
          instance
            ? <LogsTab port={instance.port} />
            : <NoInstance onRefresh={scan} scanning={scanning} />
        )}
      </div>
    </div>
  )
}

// ─── Tools ────────────────────────────────────────────────────────────────────

interface WorkflowIOField {
  nodeId: string
  nodeType: string
  nodeTitle: string
  paramName: string
  paramType: string
  defaultValue?: unknown
  options?: string[]
  isInput: boolean
}

type ToolRow = {
  id: string
  name: string
  description: string | null
  status: string
  createdAt: number
}

type FullToolDetails = {
  id: string
  name: string
  description: string | null
  status: string
  schemaJson: string
  workflowJson: string
  comfyPort: number | null
  workflowHash: string
}

type EditTab = 'configure' | 'test' | 'deploy'

function ToolsTab() {
  const [tools, setTools] = useState<ToolRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const fetchTools = useCallback(async () => {
    try {
      const r = await fetch('/api/tools')
      const data: ToolRow[] = await r.json()
      setTools(data)
      if (!selectedId && data.length > 0) setSelectedId(data[0].id)
    } catch {
      setError('Failed to load tools')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => { fetchTools() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex items-center justify-center h-full"><Spinner /></div>
  if (error) return <div className="px-6 py-4"><ErrorMsg msg={error} /></div>

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="w-56 shrink-0 border-r border-white/5 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between shrink-0">
          <span className="text-xs text-zinc-500">{tools?.length ?? 0} tools</span>
          <Link
            href="/build-tool"
            className="flex items-center gap-1 px-2 py-1 bg-zinc-100 hover:bg-white text-black text-xs font-semibold rounded transition-colors"
          >
            <Plus size={11} weight="bold" />
            New Tool
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!tools?.length ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-600">
              <Wrench size={24} />
              <p className="text-xs">No tools yet</p>
            </div>
          ) : (
            tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => setSelectedId(tool.id)}
                className={[
                  'w-full text-left px-4 py-3 border-b border-white/5 transition-colors relative',
                  selectedId === tool.id
                    ? 'bg-white/5'
                    : 'hover:bg-zinc-800/50',
                ].join(' ')}
              >
                {selectedId === tool.id && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-emerald-500" />
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-200 truncate flex-1">{tool.name}</span>
                  <span className={[
                    'text-xs px-1.5 py-0.5 rounded font-medium shrink-0',
                    tool.status === 'production'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-zinc-700/50 text-zinc-500',
                  ].join(' ')}>
                    {tool.status === 'production' ? 'prod' : 'dev'}
                  </span>
                </div>
                {tool.description && (
                  <p className="text-xs text-zinc-600 mt-0.5 truncate">{tool.description}</p>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-hidden">
        {selectedId ? (
          <ToolEditPanel key={selectedId} toolId={selectedId} onToolUpdated={fetchTools} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
            <Wrench size={32} />
            <p className="text-sm">Select a tool to edit</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tool Edit Panel ──────────────────────────────────────────────────────────

function ToolEditPanel({ toolId, onToolUpdated }: { toolId: string; onToolUpdated: () => void }) {
  const [tool, setTool] = useState<FullToolDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<EditTab>('configure')

  const loadTool = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/tools/${toolId}`)
      setTool(await r.json())
    } finally {
      setLoading(false)
    }
  }, [toolId])

  useEffect(() => { loadTool() }, [loadTool])

  if (loading) return <div className="flex items-center justify-center h-full"><Spinner /></div>
  if (!tool) return <div className="px-6 py-4"><ErrorMsg msg="Tool not found" /></div>

  const EDIT_TABS: { id: EditTab; label: string; icon: React.ElementType }[] = [
    { id: 'configure', label: 'Configure', icon: Gear },
    { id: 'test', label: 'Test', icon: FlaskConical },
    { id: 'deploy', label: 'Deploy', icon: RocketLaunch },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Panel header */}
      <div className="px-6 py-4 border-b border-white/5 shrink-0 flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded border border-white/10 bg-white/5 overflow-hidden shrink-0">
          <img src="/comfyui-logo.png" alt="ComfyUI" className="size-5 object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-100 truncate">{tool.name}</span>
            <span className={[
              'text-xs px-1.5 py-0.5 rounded font-medium shrink-0',
              tool.status === 'production'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-zinc-700/50 text-zinc-500',
            ].join(' ')}>
              {tool.status}
            </span>
          </div>
          {tool.description && <p className="text-xs text-zinc-500 truncate">{tool.description}</p>}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 px-6 pt-3 shrink-0 border-b border-white/5">
        {EDIT_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={[
              'flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-colors -mb-px border-b-2',
              activeTab === id
                ? 'text-white border-emerald-500'
                : 'text-zinc-500 hover:text-zinc-300 border-transparent',
            ].join(' ')}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {activeTab === 'configure' && (
          <ConfigurePanel tool={tool} onSaved={() => { loadTool(); onToolUpdated() }} />
        )}
        {activeTab === 'test' && <TestPanel tool={tool} />}
        {activeTab === 'deploy' && (
          <DeployPanel tool={tool} onDeployed={() => { loadTool(); onToolUpdated() }} />
        )}
      </div>
    </div>
  )
}

// ─── Configure Panel ──────────────────────────────────────────────────────────

function DefaultValueCell({ field, onChange }: { field: WorkflowIOField; onChange: (v: unknown) => void }) {
  if (!field.isInput || field.paramType === 'image') {
    return <span className="text-zinc-600 font-mono text-xs">{String(field.defaultValue ?? '—')}</span>
  }
  if (field.paramType === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(field.defaultValue)}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-emerald-500 w-4 h-4"
        onClick={(e) => e.stopPropagation()}
      />
    )
  }
  if (field.paramType === 'select' && field.options?.length) {
    return (
      <select
        value={String(field.defaultValue ?? field.options[0])}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-zinc-950 border border-white/5 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none"
      >
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  return (
    <input
      type={field.paramType === 'number' ? 'number' : 'text'}
      value={String(field.defaultValue ?? '')}
      onChange={(e) => onChange(field.paramType === 'number' ? Number(e.target.value) : e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className="w-full bg-zinc-950 border border-white/5 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none font-mono"
    />
  )
}

function SchemaTable({
  fields,
  enabledKeys,
  onToggle,
  onDefaultChange,
  isOutputs = false,
}: {
  fields: WorkflowIOField[]
  enabledKeys: Set<string>
  onToggle: (key: string) => void
  onDefaultChange: (nodeId: string, paramName: string, value: unknown) => void
  isOutputs?: boolean
}) {
  const fieldKey = (f: WorkflowIOField) => `${f.nodeId}__${f.paramName}`
  const allEnabled = fields.every((f) => enabledKeys.has(fieldKey(f)))
  const toggleAll = () => {
    fields.forEach((f) => {
      const k = fieldKey(f)
      if (allEnabled ? enabledKeys.has(k) : !enabledKeys.has(k)) onToggle(k)
    })
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <th className="py-2 px-3 text-left w-8">
              <input type="checkbox" checked={allEnabled} onChange={toggleAll} className="accent-emerald-500" />
            </th>
            <th className="py-2 px-3 text-left text-zinc-500 font-medium">Node</th>
            <th className="py-2 px-3 text-left text-zinc-500 font-medium">Field</th>
            <th className="py-2 px-3 text-left text-zinc-500 font-medium">Type</th>
            {!isOutputs && <th className="py-2 px-3 text-left text-zinc-500 font-medium">Default</th>}
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const k = fieldKey(f)
            return (
              <tr
                key={k}
                onClick={() => onToggle(k)}
                className="border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                <td className="py-2 px-3">
                  <input
                    type="checkbox"
                    checked={enabledKeys.has(k)}
                    onChange={() => onToggle(k)}
                    onClick={(e) => e.stopPropagation()}
                    className="accent-emerald-500"
                  />
                </td>
                <td className="py-2 px-3 text-zinc-400 font-mono">{f.nodeType}</td>
                <td className="py-2 px-3 text-zinc-300 font-mono">{f.paramName}</td>
                <td className="py-2 px-3">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">{f.paramType}</span>
                </td>
                {!isOutputs && (
                  <td className="py-2 px-3 max-w-[160px]">
                    <DefaultValueCell field={f} onChange={(v) => onDefaultChange(f.nodeId, f.paramName, v)} />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ConfigurePanel({ tool, onSaved }: { tool: FullToolDetails; onSaved: () => void }) {
  const parsed: WorkflowIOField[] = tool.schemaJson ? JSON.parse(tool.schemaJson) : []
  const [fields, setFields] = useState<WorkflowIOField[]>(parsed)
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(
    () => new Set(parsed.map((f) => `${f.nodeId}__${f.paramName}`))
  )
  const [name, setName] = useState(tool.name)
  const [description, setDescription] = useState(tool.description ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const handleToggle = useCallback((key: string) => {
    setEnabledKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const handleDefaultChange = useCallback((nodeId: string, paramName: string, value: unknown) => {
    setFields((prev) => prev.map((f) =>
      f.nodeId === nodeId && f.paramName === paramName ? { ...f, defaultValue: value } : f
    ))
  }, [])

  const handleSave = async () => {
    const visibleFields = fields.filter((f) => enabledKeys.has(`${f.nodeId}__${f.paramName}`))
    if (!visibleFields.some((f) => !f.isInput)) { setError('Select at least one output.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/tools/${tool.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          schemaJson: JSON.stringify(visibleFields),
        }),
      })
      if (!res.ok) { const e = await res.json(); setError(e.error ?? 'Save failed'); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    } catch {
      setError('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inputs = fields.filter((f) => f.isInput)
  const outputs = fields.filter((f) => !f.isInput)

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50 resize-none"
          />
        </div>
      </div>

      {inputs.length > 0 && (
        <Section title={`Inputs (${inputs.length})`}>
          <SchemaTable fields={inputs} enabledKeys={enabledKeys} onToggle={handleToggle} onDefaultChange={handleDefaultChange} />
        </Section>
      )}

      {outputs.length > 0 && (
        <Section title={`Outputs (${outputs.length})`}>
          <SchemaTable fields={outputs} enabledKeys={enabledKeys} onToggle={handleToggle} onDefaultChange={handleDefaultChange} isOutputs />
        </Section>
      )}

      {error && <ErrorMsg msg={error} />}

      <button
        onClick={handleSave}
        disabled={saving}
        className="self-start flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md disabled:opacity-50 transition-colors"
      >
        {saving && <ArrowClockwise size={14} className="animate-spin" />}
        {saved && <CheckCircle size={14} weight="fill" className="text-emerald-600" />}
        {saved ? 'Saved!' : 'Save Changes'}
      </button>
    </div>
  )
}

// ─── Test Panel ───────────────────────────────────────────────────────────────

function TestPanel({ tool }: { tool: FullToolDetails }) {
  return (
    <ToolTestPlayground
      tool={{ id: tool.id, name: tool.name, comfyPort: tool.comfyPort, schemaJson: tool.schemaJson }}
    />
  )
}

// ─── Deploy Panel ─────────────────────────────────────────────────────────────

function DeployPanel({ tool, onDeployed }: { tool: FullToolDetails; onDeployed: () => void }) {
  const [status, setStatus] = useState<'idle' | 'deploying' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  const handleDeploy = async () => {
    setStatus('deploying')
    setError('')
    try {
      const res = await fetch(`/api/tools/${tool.id}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) { const e = await res.json(); setError(e.error ?? 'Deploy failed'); setStatus('error'); return }
      setStatus('done')
      onDeployed()
    } catch {
      setError('Deploy failed')
      setStatus('error')
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <div className="p-4 bg-zinc-900/50 border border-white/5 rounded-xl flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Status</span>
          <span className={tool.status === 'production' ? 'text-emerald-400' : 'text-zinc-400'}>
            {tool.status}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Tool ID</span>
          <span className="text-zinc-400 font-mono text-xs truncate max-w-[180px]">{tool.id}</span>
        </div>
      </div>

      {tool.status === 'production' && (
        <p className="text-xs text-zinc-500">This tool is already in production. Redeploying will pin the latest configuration.</p>
      )}

      {error && <ErrorMsg msg={error} />}

      {status === 'done' ? (
        <div className="flex items-center gap-2 text-emerald-400 text-sm">
          <CheckCircle size={16} weight="fill" /> Deployed successfully
        </div>
      ) : (
        <button
          onClick={handleDeploy}
          disabled={status === 'deploying'}
          className="self-start flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md disabled:opacity-50 transition-colors"
        >
          {status === 'deploying' && <ArrowClockwise size={14} className="animate-spin" />}
          <RocketLaunch size={14} weight="fill" />
          {status === 'deploying' ? 'Deploying…' : tool.status === 'production' ? 'Redeploy' : 'Deploy to Production'}
        </button>
      )}
    </div>
  )
}

// ─── No Instance ──────────────────────────────────────────────────────────────

function NoInstance({ onRefresh, scanning }: { onRefresh: () => void; scanning: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600 py-24">
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
            onClick={onRefresh}
            className="mt-1 px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </>
      )}
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
