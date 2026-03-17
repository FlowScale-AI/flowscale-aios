'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  CheckCircle,
  CircleNotch,
  Eye,
  EyeSlash,
  Flask as FlaskConical,
  Folder,
  Gear,
  Key,
  MagicWand,
  Monitor,
  Play,
  Plus,
  RocketLaunch,
  Stop,
  Trash,
  UploadSimple,
  Warning,
  Wrench,
  X,
} from 'phosphor-react'
import { getComfyOrgApiKey, setComfyOrgApiKey } from '@/lib/platform'
import { LottieSpinner, StaggerGrid, StaggerItem } from '@/components/ui'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type ComfyInstallType = 'github' | 'desktop-app' | 'flowscale-managed'

type ManagedInstance = {
  id: string
  status: 'running' | 'starting' | 'stopped'
  pid?: number
  port: number
  device: string
  label: string
}

type ManageStatus = {
  instances: ManagedInstance[]
  managedPath: string | null
  installType: ComfyInstallType | null
  isSetup: boolean
  // Legacy compat — derived from first instance
  status: 'running' | 'starting' | 'stopped'
  port: number
}

// ─── Setup Wizard ─────────────────────────────────────────────────────────────

// The ComfyUI installation bundled inside the macOS Desktop App.
const MACOS_DESKTOP_COMFYUI_PATH = '/Applications/ComfyUI.app/Contents/Resources/ComfyUI'

type SetupStep = 'choose' | 'configure' | 'installing'

function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<SetupStep>('choose')
  const [installType, setInstallTypeState] = useState<ComfyInstallType | null>(null)
  const [githubPath, setGithubPath] = useState('')
  // Desktop App: the ComfyUI app bundle path (auto-detected or user-provided)
  const [desktopComfyPath, setDesktopComfyPath] = useState(MACOS_DESKTOP_COMFYUI_PATH)
  const [desktopPathValid, setDesktopPathValid] = useState<boolean | null>(null)
  const [desktopPathValidating, setDesktopPathValidating] = useState(false)
  // Desktop App: the user-data folder (models, custom_nodes)
  const [desktopUserDataPath, setDesktopUserDataPath] = useState('')
  const [port, setPort] = useState('8188')
  const [installLog, setInstallLog] = useState<string[]>([])
  const [installError, setInstallError] = useState('')
  const [saving, setSaving] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [installLog])

  // Auto-validate the Desktop App path whenever the configure step is shown
  useEffect(() => {
    if (step === 'configure' && installType === 'desktop-app') {
      validateDesktopPath(desktopComfyPath)
    }
  }, [step, installType, desktopComfyPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const validateDesktopPath = async (p: string) => {
    if (!p.trim()) { setDesktopPathValid(false); return }
    setDesktopPathValidating(true)
    try {
      const res = await fetch(`/api/comfy/setup/validate-path?path=${encodeURIComponent(p.trim())}`)
      const data = await res.json() as { valid: boolean }
      setDesktopPathValid(data.valid)
    } catch {
      setDesktopPathValid(false)
    } finally {
      setDesktopPathValidating(false)
    }
  }

  const pickDir = async (): Promise<string | null> => {
    if (typeof window !== 'undefined' && window.desktop?.dialog?.openDirectory) {
      return window.desktop.dialog.openDirectory()
    }
    return null
  }

  const saveSettings = async (
    type: ComfyInstallType,
    managedPath: string,
    desktopPath?: string,
  ): Promise<void> => {
    await fetch('/api/settings/comfyui-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installType: type,
        managedPath,
        managedPort: parseInt(port, 10) || 8188,
        ...(desktopPath ? { desktopUserDataPath: desktopPath } : {}),
      }),
    })
  }

  const handleGithubSave = async () => {
    if (!githubPath.trim()) return
    setSaving(true)
    await saveSettings('github', githubPath.trim())
    setSaving(false)
    onComplete()
  }

  const handleDesktopSave = async () => {
    if (!desktopUserDataPath.trim()) return
    setSaving(true)
    setStep('installing')

    try {
      if (desktopPathValid) {
        // The Desktop App's bundled ComfyUI is valid — use it directly.
        // Pass targetPath so the install route short-circuits without cloning.
        await saveSettings('desktop-app', desktopComfyPath.trim(), desktopUserDataPath.trim())
        await runInstall(desktopComfyPath.trim())
      } else {
        // Bundled ComfyUI not found — clone into ~/.flowscale/comfyui then copy assets.
        await saveSettings('desktop-app', '', desktopUserDataPath.trim())
        await runInstall()
      }
    } finally {
      setSaving(false)
    }
  }

  const runInstall = async (targetPath?: string) => {
    setInstallError('')
    setInstallLog([])
    try {
      const res = await fetch('/api/comfy/setup/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetPath ? { targetPath } : {}),
      })
      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = JSON.parse(line.slice(6)) as { msg?: string; done?: boolean; error?: string }
          if (payload.error) { setInstallError(payload.error); return }
          if (payload.msg) setInstallLog((prev) => [...prev, payload.msg!])
          if (payload.done) {
            if (installType === 'desktop-app' && desktopUserDataPath.trim()) {
              setInstallLog((prev) => [...prev, 'Copying custom nodes and configuring model paths…'])
              const copyRes = await fetch('/api/comfy/setup/copy-assets', { method: 'POST' })
              const copyData = await copyRes.json() as { success?: boolean; error?: string; customNodesCopied?: number }
              if (copyData.error) { setInstallError(copyData.error); return }
              setInstallLog((prev) => [
                ...prev,
                `Custom nodes copied: ${copyData.customNodesCopied ?? 0}`,
                'Model paths configured via extra_model_paths.yaml',
              ])
            }
            onComplete()
          }
        }
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleFreshInstall = async () => {
    setInstallTypeState('flowscale-managed')
    setStep('installing')
    await saveSettings('flowscale-managed', '')
    await runInstall()
  }

  if (step === 'installing') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
        <div className="w-full max-w-xl">
          <h2 className="text-white font-medium font-tech text-lg mb-1">Installing ComfyUI</h2>
          <p className="text-zinc-500 text-sm mb-4">This may take a few minutes. Please don't close the app.</p>
          {installError ? (
            <div className="bg-red-950/40 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm font-mono">
              {installError}
            </div>
          ) : (
            <div
              ref={logRef}
              className="bg-black/40 border border-white/5 rounded-lg p-4 h-64 overflow-y-auto text-xs font-mono text-zinc-400 space-y-1"
            >
              {installLog.length === 0 ? (
                <div className="flex items-center gap-2 text-zinc-500">
                  <CircleNotch size={14} className="animate-spin" />
                  Starting…
                </div>
              ) : (
                installLog.map((line, i) => <div key={i}>{line}</div>)
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (step === 'configure') {
    if (installType === 'github') {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
          <div className="w-full max-w-md space-y-4">
            <div>
              <h2 className="text-white font-medium font-tech text-lg">GitHub Clone Path</h2>
              <p className="text-zinc-500 text-sm mt-1">
                Point AIOS to the root of your ComfyUI GitHub clone (the folder containing <code className="text-zinc-300">main.py</code>).
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">ComfyUI directory</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                  placeholder="/home/user/ComfyUI"
                  value={githubPath}
                  onChange={(e) => setGithubPath(e.target.value)}
                />
                {window.desktop?.dialog?.openDirectory && (
                  <button
                    className="px-3 py-2 bg-zinc-800 rounded-lg text-zinc-300 hover:bg-zinc-700 transition-colors"
                    onClick={async () => { const p = await pickDir(); if (p) setGithubPath(p) }}
                  >
                    <Folder size={15} />
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Port</label>
              <input
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                placeholder="8188"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep('choose')}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleGithubSave}
                disabled={!githubPath.trim() || saving}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Save & Continue'}
              </button>
            </div>
          </div>
        </div>
      )
    }

    if (installType === 'desktop-app') {
      const buttonLabel = desktopPathValid ? 'Configure' : 'Clone & Configure'
      return (
        <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
          <div className="w-full max-w-md space-y-4">
            <div>
              <h2 className="text-white font-medium font-tech text-lg">ComfyUI Desktop App</h2>
              <p className="text-zinc-500 text-sm mt-1">
                AIOS auto-detects the bundled ComfyUI. Then point it to where the Desktop App stores
                your models and custom nodes — the folder containing <code className="text-zinc-300">models/</code> and{' '}
                <code className="text-zinc-300">custom_nodes/</code> (not the AppData folder).
              </p>
            </div>

            {/* ComfyUI app path (auto-detected) */}
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">ComfyUI app path</label>
              <div className="flex gap-2">
                <input
                  className={[
                    'flex-1 bg-zinc-900 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none',
                    desktopPathValid === true
                      ? 'border-emerald-500/50'
                      : desktopPathValid === false
                        ? 'border-red-500/50 focus:border-red-500/50'
                        : 'border-zinc-800 focus:border-emerald-500/50',
                  ].join(' ')}
                  value={desktopComfyPath}
                  onChange={(e) => {
                    setDesktopComfyPath(e.target.value)
                    setDesktopPathValid(null)
                  }}
                  onBlur={(e) => validateDesktopPath(e.target.value)}
                />
                {window.desktop?.dialog?.openDirectory && (
                  <button
                    className="px-3 py-2 bg-zinc-800 rounded-lg text-zinc-300 hover:bg-zinc-700 transition-colors"
                    onClick={async () => {
                      const p = await pickDir()
                      if (p) { setDesktopComfyPath(p); setDesktopPathValid(null); validateDesktopPath(p) }
                    }}
                  >
                    <Folder size={15} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                {desktopPathValidating ? (
                  <><CircleNotch size={11} className="animate-spin text-zinc-500" /><span className="text-zinc-500">Checking…</span></>
                ) : desktopPathValid === true ? (
                  <><CheckCircle size={11} weight="fill" className="text-emerald-400" /><span className="text-emerald-400">ComfyUI detected — no installation needed</span></>
                ) : desktopPathValid === false ? (
                  <><Warning size={11} className="text-amber-400" /><span className="text-amber-400">Not found — will clone ComfyUI into ~/.flowscale/comfyui</span></>
                ) : null}
              </div>
            </div>

            {/* User-data folder */}
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Desktop app user-data folder (models &amp; custom nodes)</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                  placeholder="C:\Users\you\ComfyUI  or  ~/ComfyUI"
                  value={desktopUserDataPath}
                  onChange={(e) => setDesktopUserDataPath(e.target.value)}
                />
                {window.desktop?.dialog?.openDirectory && (
                  <button
                    className="px-3 py-2 bg-zinc-800 rounded-lg text-zinc-300 hover:bg-zinc-700 transition-colors"
                    onClick={async () => { const p = await pickDir(); if (p) setDesktopUserDataPath(p) }}
                  >
                    <Folder size={15} />
                  </button>
                )}
              </div>
              <p className="text-xs text-zinc-600">
                Custom nodes will be copied. Models are linked via extra_model_paths.yaml (no large copies).
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Port</label>
              <input
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                placeholder="8188"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep('choose')}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleDesktopSave}
                disabled={!desktopUserDataPath.trim() || saving || desktopPathValidating}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : buttonLabel}
              </button>
            </div>
          </div>
        </div>
      )
    }
  }

  // step === 'choose'
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-8">
      <div className="text-center">
        <h2 className="text-white font-medium font-tech text-xl mb-2">Connect ComfyUI</h2>
        <p className="text-zinc-500 text-sm max-w-md">
          AIOS manages a single ComfyUI instance. Choose how you have ComfyUI installed.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 w-full max-w-sm">
        <button
          onClick={() => { setInstallTypeState('github'); setStep('configure') }}
          className="flex items-start gap-4 p-4 bg-zinc-900/60 border border-white/5 rounded-xl hover:border-emerald-500/30 hover:bg-zinc-900 transition-all text-left"
        >
          <div className="mt-0.5 text-emerald-400"><Folder size={20} /></div>
          <div>
            <div className="text-white text-sm font-medium">I have a GitHub clone</div>
            <div className="text-zinc-500 text-xs mt-0.5">Use an existing ComfyUI repo you cloned from GitHub</div>
          </div>
        </button>
        <button
          onClick={() => { setInstallTypeState('desktop-app'); setStep('configure') }}
          className="flex items-start gap-4 p-4 bg-zinc-900/60 border border-white/5 rounded-xl hover:border-emerald-500/30 hover:bg-zinc-900 transition-all text-left"
        >
          <div className="mt-0.5 text-blue-400"><Monitor size={20} /></div>
          <div>
            <div className="text-white text-sm font-medium">ComfyUI Desktop App</div>
            <div className="text-zinc-500 text-xs mt-0.5">You have the official ComfyUI desktop app installed — AIOS will set up its own instance and import your models & custom nodes</div>
          </div>
        </button>
        <button
          onClick={handleFreshInstall}
          className="flex items-start gap-4 p-4 bg-zinc-900/60 border border-white/5 rounded-xl hover:border-emerald-500/30 hover:bg-zinc-900 transition-all text-left"
        >
          <div className="mt-0.5 text-purple-400"><RocketLaunch size={20} /></div>
          <div>
            <div className="text-white text-sm font-medium">Install ComfyUI for me</div>
            <div className="text-zinc-500 text-xs mt-0.5">Clone ComfyUI from GitHub and install it automatically into ~/.flowscale/comfyui</div>
          </div>
        </button>
      </div>
    </div>
  )
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
  const router = useRouter()
  const [instance, setInstance] = useState<ComfyInstance | null>(null)
  const [scanning, setScanning] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [manageStatus, setManageStatus] = useState<ManageStatus | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadManageStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/comfy/manage')
      const raw = await res.json()
      const instances: ManagedInstance[] = raw.instances ?? []
      // Derive legacy status from selected or first instance
      const primary = instances.find((i: ManagedInstance) => i.id === selectedInstanceId) ?? instances[0]
      const data: ManageStatus = {
        ...raw,
        instances,
        status: primary?.status ?? 'stopped',
        port: primary?.port ?? 8188,
      }
      setManageStatus(data)
      // Auto-select first instance if none selected
      if (!selectedInstanceId && instances.length > 0) {
        setSelectedInstanceId(instances[0].id)
      }
      return data
    } catch {
      return null
    }
  }, [selectedInstanceId])

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/comfy/scan')
      const data: ComfyInstance[] = await res.json()
      // Pick the instance matching selectedInstanceId, or first
      const match = data.find((i) => (i as { instanceId?: string }).instanceId === selectedInstanceId) ?? data[0]
      setInstance(match ?? null)
    } finally {
      setScanning(false)
    }
  }, [selectedInstanceId])

  // Poll when starting so the UI catches when ComfyUI becomes ready
  useEffect(() => {
    if (manageStatus?.status === 'starting') {
      pollTimerRef.current = setInterval(async () => {
        const s = await loadManageStatus()
        if (s?.status === 'running') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current)
          scan()
        }
      }, 2000)
    } else {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    }
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }
  }, [manageStatus?.status, loadManageStatus, scan])

  useEffect(() => {
    loadManageStatus().then((s) => {
      if (s?.status === 'running') scan()
    })
  }, [selectedInstanceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    setActionPending(true)
    try {
      await fetch('/api/comfy/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, instanceId: selectedInstanceId }),
      })
      await loadManageStatus()
      if (action === 'stop') setInstance(null)
    } finally {
      setActionPending(false)
    }
  }

  const handleSetupComplete = async () => {
    await loadManageStatus()
  }

  const stats = instance?.systemStats as SysInfo | null
  const isSetup = manageStatus?.isSetup ?? false
  const comfyStatus = manageStatus?.status ?? 'stopped'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        <button
          onClick={() => router.back()}
          className="text-zinc-500 hover:text-zinc-200 transition-colors shrink-0"
          title="Go back"
        >
          <ArrowLeft size={16} />
        </button>

        {/* Status indicator */}
        {scanning || comfyStatus === 'starting' ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <CircleNotch size={14} className="animate-spin" />
            {comfyStatus === 'starting' ? 'ComfyUI starting…' : 'Scanning…'}
          </div>
        ) : instance ? (
          <>
            <div className="flex items-center gap-2">
              <CheckCircle size={16} weight="fill" className="text-emerald-400" />
              <span className="text-white font-medium">ComfyUI</span>
              <span className="text-zinc-500 text-sm">127.0.0.1:{instance.port}</span>
            </div>
            <span className="text-zinc-600 text-sm">{stats?.system?.comfyui_version ?? ''}</span>
          </>
        ) : isSetup ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <Warning size={14} />
            ComfyUI is not running
          </div>
        ) : (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <Warning size={14} />
            ComfyUI not configured
          </div>
        )}

        {/* Instance selector — shown when multiple instances */}
        {isSetup && (manageStatus?.instances?.length ?? 0) > 1 && (
          <select
            value={selectedInstanceId ?? ''}
            onChange={(e) => {
              setSelectedInstanceId(e.target.value)
              setInstance(null) // reset scan data for new instance
            }}
            className="ml-2 px-2 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 focus:outline-none focus:border-zinc-600"
          >
            {manageStatus!.instances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.label} (:{inst.port})
              </option>
            ))}
          </select>
        )}

        {/* Process controls — only shown once configured */}
        {isSetup && (
          <div className="ml-auto flex items-center gap-2">
            {comfyStatus === 'stopped' && (
              <button
                onClick={() => handleAction('start')}
                disabled={actionPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
                title="Start ComfyUI"
              >
                <Play size={12} weight="fill" />
                Start
              </button>
            )}
            {(comfyStatus === 'running' || comfyStatus === 'starting') && (
              <>
                <button
                  onClick={() => handleAction('restart')}
                  disabled={actionPending || comfyStatus === 'starting'}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs rounded-lg transition-colors"
                  title="Restart ComfyUI"
                >
                  <ArrowCounterClockwise size={12} />
                  Restart
                </button>
                <button
                  onClick={() => handleAction('stop')}
                  disabled={actionPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/60 hover:bg-red-800/60 disabled:opacity-40 text-red-300 text-xs rounded-lg transition-colors"
                  title="Stop ComfyUI"
                >
                  <Stop size={12} weight="fill" />
                  Stop
                </button>
              </>
            )}
            <button
              onClick={async () => { await loadManageStatus(); if (comfyStatus === 'running') scan() }}
              disabled={scanning}
              className="text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40 p-1"
              title="Refresh"
            >
              <ArrowClockwise size={15} className={scanning ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      {/* Setup wizard — shown until configured */}
      {!isSetup && manageStatus !== null && (
        <SetupWizard onComplete={handleSetupComplete} />
      )}

      {/* Main content — shown once configured */}
      {isSetup && (
        <>
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
                : <NoInstance onRefresh={() => { loadManageStatus(); scan() }} scanning={scanning} />
            )}
            {tab === 'tools' && <ToolsTab />}
            {tab === 'models' && (
              instance
                ? <ModelsTab port={instance.port} />
                : <NoInstance onRefresh={() => { loadManageStatus(); scan() }} scanning={scanning} />
            )}
            {tab === 'custom-nodes' && (
              instance
                ? <CustomNodesTab port={instance.port} />
                : <NoInstance onRefresh={() => { loadManageStatus(); scan() }} scanning={scanning} />
            )}
            {tab === 'logs' && (
              instance
                ? <LogsTab port={instance.port} />
                : <NoInstance onRefresh={() => { loadManageStatus(); scan() }} scanning={scanning} />
            )}
          </div>
        </>
      )}
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
  label?: string
  options?: string[]
  isInput: boolean
  enabled?: boolean  // undefined / true = visible; false = hidden
}

type ToolRow = {
  id: string
  name: string
  description: string | null
  status: string
  engine: string
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

type EditTab = 'configure' | 'test'

function ToolsTab() {
  const [tools, setTools] = useState<ToolRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const fetchTools = useCallback(async () => {
    try {
      const r = await fetch('/api/tools')
      const data: ToolRow[] = await r.json()
      const filtered = data.filter((t) => t.engine === 'comfyui')
      setTools(filtered)
      if (selectedId && !filtered.find((t) => t.id === selectedId)) setSelectedId(null)
      else if (!selectedId && !creating && filtered.length > 0) setSelectedId(filtered[0].id)
    } catch {
      setError('Failed to load tools')
    } finally {
      setLoading(false)
    }
  }, [selectedId, creating])

  useEffect(() => { fetchTools() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewTool = () => {
    setCreating(true)
    setSelectedId(null)
  }

  const [freshlyCreatedId, setFreshlyCreatedId] = useState<string | null>(null)

  const handleCreated = (id: string) => {
    setCreating(false)
    setSelectedId(id)
    setFreshlyCreatedId(id)
    fetchTools()
  }

  const handleCancelCreate = () => {
    setCreating(false)
    if (!selectedId && tools?.length) setSelectedId(tools[0].id)
  }

  if (loading) return <div className="flex items-center justify-center h-full"><Spinner /></div>
  if (error) return <div className="px-6 py-4"><ErrorMsg msg={error} /></div>

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="w-56 shrink-0 border-r border-white/5 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between shrink-0">
          <span className="text-xs text-zinc-500">{tools?.length ?? 0} tools</span>
          <button
            onClick={handleNewTool}
            className="flex items-center gap-1 px-2 py-1 bg-zinc-100 hover:bg-white text-black text-xs font-semibold rounded transition-colors"
          >
            <Plus size={11} weight="bold" />
            New Tool
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Placeholder while creating */}
          {creating && (
            <div className="w-full text-left px-4 py-3 border-b border-white/5 bg-white/5 relative">
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-emerald-500" />
              <span className="text-sm text-zinc-400 italic">Untitled</span>
            </div>
          )}
          {!creating && !tools?.length ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-600">
              <Wrench size={24} />
              <p className="text-xs">No tools yet</p>
            </div>
          ) : (
            tools?.map((tool) => (
              <button
                key={tool.id}
                onClick={() => { setSelectedId(tool.id); setCreating(false) }}
                className={[
                  'w-full text-left px-4 py-3 border-b border-white/5 transition-colors relative',
                  selectedId === tool.id && !creating ? 'bg-white/5' : 'hover:bg-zinc-800/50',
                ].join(' ')}
              >
                {selectedId === tool.id && !creating && (
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
        {creating ? (
          <NewToolPanel onCreated={handleCreated} onCancel={handleCancelCreate} />
        ) : selectedId ? (
          <ToolEditPanel key={selectedId} toolId={selectedId} initialTab={freshlyCreatedId === selectedId ? 'test' : 'configure'} onToolUpdated={fetchTools} onToolDeleted={() => { setSelectedId(null); fetchTools() }} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
            <Wrench size={32} />
            <p className="text-sm">Select a tool or create a new one</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── New Tool Panel ───────────────────────────────────────────────────────────

function NewToolUploadModal({
  onClose,
  onNext,
}: {
  onClose: () => void
  onNext: (workflowJson: string, name: string) => void
}) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => { setText(e.target?.result as string); setError('') }
    reader.readAsText(file)
    setFileName(file.name.replace(/\.json$/i, ''))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const handleNext = () => {
    if (!text.trim()) { setError('Paste a workflow JSON or upload a file.'); return }
    try { JSON.parse(text) } catch { setError('Invalid JSON.'); return }
    onNext(text, fileName)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-zinc-950 border border-white/10 rounded-xl shadow-xl flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">Upload Workflow</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors"><X size={16} /></button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
        <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}
          className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-white/10 rounded-xl hover:border-emerald-500/30 transition-colors">
          <UploadSimple size={22} weight="duotone" className="text-zinc-500" />
          <p className="text-sm text-zinc-400">Drop a .json here, or</p>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-medium rounded-md transition-colors">
            Browse file…
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-xs text-zinc-600">or paste JSON</span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setError('') }}
          placeholder='{"last_node_id": 9, "nodes": [...]}'
          rows={5}
          className="bg-zinc-900 border border-white/5 rounded-lg px-3 py-2.5 text-xs font-mono text-zinc-300 focus:outline-none focus:border-emerald-500/50 resize-none placeholder:text-zinc-700" />
        {error && <p className="text-xs text-red-400 flex items-center gap-1"><Warning size={12} weight="fill" />{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
          <button onClick={handleNext}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md transition-colors">
            Analyze Workflow
          </button>
        </div>
      </div>
    </div>
  )
}

function NewToolPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<'attach' | 'configure'>('attach')
  const [workflowJson, setWorkflowJson] = useState('')
  const [workflowName, setWorkflowName] = useState('')

  const handleAttached = (json: string, name: string) => {
    setWorkflowJson(json)
    setWorkflowName(name)
    setStep('configure')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 shrink-0 flex items-center gap-3">
        {step === 'configure' && (
          <button onClick={() => setStep('attach')} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-100">New Tool</p>
          <p className="text-xs text-zinc-500">{step === 'attach' ? 'Step 1 — Attach workflow' : 'Step 2 — Configure'}</p>
        </div>
        <button onClick={onCancel} className="text-zinc-600 hover:text-zinc-400 transition-colors"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {step === 'attach'
          ? <NewToolAttach onNext={handleAttached} />
          : <NewToolConfigure workflowJson={workflowJson} initialName={workflowName} onCreated={onCreated} />
        }
      </div>
    </div>
  )
}

function NewToolAttach({ onNext }: { onNext: (json: string, name: string) => void }) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [instances, setInstances] = useState<ComfyInstance[]>([])
  const [selectedPort, setSelectedPort] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  const [workflows, setWorkflows] = useState<string[]>([])
  const [loadingWorkflows, setLoadingWorkflows] = useState(false)
  const [loadingFile, setLoadingFile] = useState<string | null>(null)
  const [error, setError] = useState('')

  const scanPorts = async () => {
    setScanning(true)
    try {
      const data: ComfyInstance[] = await fetch('/api/comfy/scan').then((r) => r.json())
      setInstances(data)
      if (data.length > 0) setSelectedPort(data[0].port)
    } catch { /* ignore */ } finally { setScanning(false) }
  }

  const fetchWorkflows = useCallback(async (port: number) => {
    setLoadingWorkflows(true)
    setWorkflows([])
    try {
      const res = await fetch(`/api/comfy/${port}/userdata?dir=workflows&recurse=true`)
      if (!res.ok) return
      const data = await res.json()
      const files: string[] = Array.isArray(data) ? data : (data.files ?? [])
      setWorkflows(files.filter((f: string) => f.endsWith('.json')))
    } catch { /* ignore */ } finally { setLoadingWorkflows(false) }
  }, [])

  useEffect(() => { scanPorts() }, [])
  useEffect(() => { if (selectedPort) fetchWorkflows(selectedPort) }, [selectedPort, fetchWorkflows])

  const handlePick = async (filename: string) => {
    if (!selectedPort) return
    setLoadingFile(filename)
    setError('')
    try {
      const encoded = encodeURIComponent(`workflows/${filename}`)
      const res = await fetch(`/api/comfy/${selectedPort}/userdata/${encoded}`)
      if (!res.ok) throw new Error(`Failed to load workflow (${res.status})`)
      const json = await res.text()
      JSON.parse(json)
      onNext(json, filename.replace(/\.json$/i, ''))
    } catch (e: any) {
      setError(e.message ?? 'Failed to load workflow')
    } finally { setLoadingFile(null) }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100 mb-0.5">Attach Workflow</h2>
          <p className="text-xs text-zinc-500">Pick a saved ComfyUI workflow or upload a file.</p>
        </div>
        <button onClick={() => setUploadOpen(true)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 text-zinc-300 text-xs font-medium rounded-md transition-colors">
          <UploadSimple size={13} /> Upload / Paste
        </button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          ComfyUI Instance {selectedPort ? <span className="text-zinc-600 font-mono normal-case">:{selectedPort}</span> : ''}
        </span>
        <button onClick={scanPorts} disabled={scanning}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50">
          <ArrowCounterClockwise size={11} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      {scanning && instances.length === 0 && (
        <div className="flex items-center gap-2 text-zinc-500 text-xs"><LottieSpinner size={13} /> Scanning for ComfyUI…</div>
      )}
      {!scanning && instances.length === 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-950/20 border border-amber-900/30 rounded-lg text-amber-400 text-xs">
          <Monitor size={14} weight="duotone" /> No running ComfyUI detected. Start ComfyUI and click Refresh.
        </div>
      )}
      {loadingWorkflows && (
        <div className="flex items-center gap-2 text-zinc-500 text-xs"><LottieSpinner size={13} /> Loading workflows…</div>
      )}
      {!loadingWorkflows && selectedPort && workflows.length === 0 && (
        <div className="flex flex-col items-center py-10 gap-2 text-zinc-600">
          <MagicWand size={24} weight="duotone" />
          <span className="text-xs">No saved workflows found</span>
        </div>
      )}
      {!loadingWorkflows && workflows.length > 0 && (
        <StaggerGrid className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {workflows.map((path) => {
            const name = path.replace(/\.json$/, '')
            const isLoading = loadingFile === path
            return (
              <StaggerItem key={path}>
                <button onClick={() => handlePick(path)} disabled={loadingFile !== null}
                  className="group flex flex-col rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 hover:bg-zinc-900 hover:border-emerald-500/30 hover:shadow-xl hover:shadow-emerald-900/10 hover:-translate-y-1 transition-all duration-200 disabled:opacity-50 text-left w-full">
                  <div className="relative h-36 bg-[var(--color-background-canvas)] overflow-hidden bg-grid-pattern flex items-center justify-center">
                    {isLoading ? <LottieSpinner size={20} /> : <MagicWand size={28} weight="duotone" className="text-zinc-700 group-hover:text-emerald-500 transition-colors" />}
                    <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#18181b] to-transparent" />
                  </div>
                  <div className="px-3 py-2 bg-[#18181b]">
                    <p className="text-xs font-medium text-zinc-100 truncate">{name}</p>
                  </div>
                </button>
              </StaggerItem>
            )
          })}
        </StaggerGrid>
      )}
      {error && <ErrorMsg msg={error} />}
      {uploadOpen && <NewToolUploadModal onClose={() => setUploadOpen(false)} onNext={(json, name) => { setUploadOpen(false); onNext(json, name) }} />}
    </div>
  )
}

function NewToolConfigure({
  workflowJson,
  initialName,
  onCreated,
}: {
  workflowJson: string
  initialName: string
  onCreated: (id: string) => void
}) {
  const [schema, setSchema] = useState<WorkflowIOField[] | null>(null)
  const [workflowHash, setWorkflowHash] = useState('')
  const [instances, setInstances] = useState<ComfyInstance[]>([])
  const [selectedPort, setSelectedPort] = useState<number | null>(null)
  const [name, setName] = useState(initialName || 'Untitled')
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set())
  const [analyzeError, setAnalyzeError] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const fieldKey = (f: WorkflowIOField) => `${f.nodeId}__${f.paramName}`

  const analyze = useCallback(async (port?: number | null) => {
    setAnalyzeError('')
    try {
      const body: Record<string, unknown> = { workflowJson }
      if (port) body.comfyPort = port
      const res = await fetch('/api/workflow/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json(); setAnalyzeError(e.error ?? 'Analysis failed'); return }
      const { schema: s, hash } = await res.json()
      setSchema(s)
      setWorkflowHash(hash)
      setEnabledKeys((prev) => {
        const next = new Set(prev)
        for (const f of s as WorkflowIOField[]) next.add(fieldKey(f))
        return next
      })
    } catch { setAnalyzeError('Failed to analyze workflow') }
  }, [workflowJson]) // eslint-disable-line react-hooks/exhaustive-deps

  const scanPorts = async () => {
    try {
      const data: ComfyInstance[] = await fetch('/api/comfy/scan').then((r) => r.json())
      setInstances(data)
      if (data.length > 0) setSelectedPort(data[0].port)
    } catch { /* ignore */ }
  }

  useEffect(() => { analyze(); scanPorts() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPort) analyze(selectedPort) }, [selectedPort]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDefaultChange = useCallback((nodeId: string, paramName: string, value: unknown) => {
    setSchema((prev) => prev?.map((f) =>
      f.nodeId === nodeId && f.paramName === paramName ? { ...f, defaultValue: value } : f
    ) ?? null)
  }, [])

  const handleSave = async () => {
    if (!name.trim()) { setError('Enter a tool name.'); return }
    if (!schema) { setError('Workflow analysis in progress.'); return }
    const withEnabled = schema.map((f) => ({ ...f, enabled: enabledKeys.has(fieldKey(f)) }))
    if (!withEnabled.some((f) => !f.isInput && f.enabled)) { setError('Select at least one output.'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/tools', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), workflowJson, workflowHash, schemaJson: JSON.stringify(withEnabled), comfyPort: selectedPort }),
      })
      if (!res.ok) { const e = await res.json(); setError(e.error ?? 'Failed to create tool'); return }
      const tool = await res.json()
      onCreated(tool.id)
    } catch { setError('Failed to create tool') } finally { setSaving(false) }
  }

  const inputs = schema?.filter((f) => f.isInput) ?? []
  const outputs = schema?.filter((f) => !f.isInput) ?? []

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100 mb-0.5">Configure Tool</h2>
        <p className="text-xs text-zinc-500">Name your tool and choose which inputs and outputs to expose.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50" />
      </div>

      {analyzeError && <ErrorMsg msg={analyzeError} />}

      {!schema && !analyzeError && (
        <div className="flex items-center gap-2 text-zinc-500 text-xs"><LottieSpinner size={13} /> Analyzing workflow…</div>
      )}

      {schema && (
        <>
          {inputs.length > 0 && (
            <Section title={`Inputs (${inputs.length})`}>
              <SchemaTable fields={inputs} enabledKeys={enabledKeys} onToggle={(k) => setEnabledKeys((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })} onDefaultChange={handleDefaultChange} onLabelChange={() => {}} />
            </Section>
          )}
          {outputs.length > 0 && (
            <Section title={`Outputs (${outputs.length})`}>
              <SchemaTable fields={outputs} enabledKeys={enabledKeys} onToggle={(k) => setEnabledKeys((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })} onDefaultChange={handleDefaultChange} onLabelChange={() => {}} isOutputs />
            </Section>
          )}
        </>
      )}

      {error && <ErrorMsg msg={error} />}

      <button onClick={handleSave} disabled={saving || !schema}
        className="self-start flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-black text-sm font-semibold rounded-md disabled:opacity-50 transition-colors">
        {saving && <ArrowClockwise size={14} className="animate-spin" />}
        {saving ? 'Creating…' : 'Create Tool'}
      </button>
    </div>
  )
}

// ─── Tool Edit Panel ──────────────────────────────────────────────────────────

function ToolEditPanel({ toolId, initialTab = 'configure', onToolUpdated, onToolDeleted }: { toolId: string; initialTab?: EditTab; onToolUpdated: () => void; onToolDeleted: () => void }) {
  const [tool, setTool] = useState<FullToolDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<EditTab>(initialTab)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deployStatus, setDeployStatus] = useState<'idle' | 'deploying' | 'done' | 'error'>('idle')
  const [deployError, setDeployError] = useState('')

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

  const handleDelete = async () => {
    setDeleting(true)
    await fetch(`/api/tools/${toolId}`, { method: 'DELETE' })
    onToolDeleted()
  }

  const handleDeploy = async () => {
    setDeployStatus('deploying')
    setDeployError('')
    try {
      const res = await fetch(`/api/tools/${toolId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) { const e = await res.json(); setDeployError(e.error ?? 'Deploy failed'); setDeployStatus('error'); return }
      setDeployStatus('done')
      loadTool()
      onToolUpdated()
    } catch {
      setDeployError('Deploy failed')
      setDeployStatus('error')
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full"><Spinner /></div>
  if (!tool) return <div className="px-6 py-4"><ErrorMsg msg="Tool not found" /></div>

  const EDIT_TABS: { id: EditTab; label: string; icon: React.ElementType }[] = [
    { id: 'configure', label: 'Configure', icon: Gear },
    { id: 'test', label: 'Test', icon: FlaskConical },
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
        {/* Deploy button */}
        {deployStatus === 'done' ? (
          <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium shrink-0">
            <CheckCircle size={13} weight="fill" /> Deployed
          </div>
        ) : (
          <button
            onClick={handleDeploy}
            disabled={deployStatus === 'deploying'}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-white text-black text-xs font-semibold rounded-md disabled:opacity-50 transition-colors"
            title={deployError || undefined}
          >
            {deployStatus === 'deploying'
              ? <ArrowClockwise size={12} className="animate-spin" />
              : <RocketLaunch size={12} weight="fill" />}
            {deployStatus === 'deploying' ? 'Deploying…' : tool.status === 'production' ? 'Redeploy' : 'Deploy'}
          </button>
        )}
        {/* Delete button */}
        {confirmDelete ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-zinc-400">Delete?</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1 px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium rounded transition-colors disabled:opacity-50"
            >
              {deleting ? <ArrowClockwise size={11} className="animate-spin" /> : null}
              Yes
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex items-center px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-medium rounded transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="shrink-0 flex items-center justify-center size-7 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors border border-red-500/20"
            title="Delete tool"
          >
            <Trash size={14} />
          </button>
        )}
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
      <div className={['flex-1', activeTab === 'test' ? 'overflow-hidden' : 'overflow-y-auto px-6 py-5'].join(' ')}>
        {activeTab === 'configure' && (
          <ConfigurePanel tool={tool} onSaved={() => { loadTool(); onToolUpdated(); setActiveTab('test') }} />
        )}
        {activeTab === 'test' && <TestPanel tool={tool} />}
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
  onLabelChange,
  isOutputs = false,
}: {
  fields: WorkflowIOField[]
  enabledKeys: Set<string>
  onToggle: (key: string) => void
  onDefaultChange: (nodeId: string, paramName: string, value: unknown) => void
  onLabelChange: (nodeId: string, paramName: string, value: string) => void
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
            <th className="py-2 px-3 text-left text-zinc-500 font-medium">Label</th>
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
                <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={f.label ?? ''}
                    onChange={(e) => onLabelChange(f.nodeId, f.paramName, e.target.value)}
                    placeholder={f.nodeTitle ? `${f.nodeTitle} — ${f.paramName}` : f.paramName}
                    className="w-full bg-transparent border border-transparent hover:border-white/10 focus:border-emerald-500/50 rounded px-1.5 py-0.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none transition-colors min-w-[120px]"
                  />
                </td>
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
  const fieldKey = (f: WorkflowIOField) => `${f.nodeId}__${f.paramName}`

  // Seed from saved schema — determine which keys were enabled
  const savedFields: WorkflowIOField[] = tool.schemaJson ? JSON.parse(tool.schemaJson) : []
  const savedEnabledKeys = new Set(
    savedFields.filter((f) => f.enabled !== false).map(fieldKey)
  )

  const [fields, setFields] = useState<WorkflowIOField[]>(savedFields)
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(savedEnabledKeys)
  const [name, setName] = useState(tool.name)
  const [description, setDescription] = useState(tool.description ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)

  // Re-analyze the stored workflow to recover any fields that were unchecked at creation time
  useEffect(() => {
    if (!tool.workflowJson) return
    setAnalyzing(true)
    fetch('/api/workflow/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowJson: tool.workflowJson,
        ...(tool.comfyPort ? { comfyPort: tool.comfyPort } : {}),
      }),
    })
      .then((r) => r.json())
      .then((data: { schema?: WorkflowIOField[] }) => {
        if (!data.schema?.length) return
        // Merge: prefer saved default values; newly found fields default to disabled
        const savedMap = new Map(savedFields.map((f) => [fieldKey(f), f]))
        const merged = data.schema.map((f) => {
          const saved = savedMap.get(fieldKey(f))
          return saved ? { ...f, defaultValue: saved.defaultValue, label: saved.label } : f
        })
        setFields(merged)
        // Keep enabled state: saved fields stay as-is, new fields start unchecked
      })
      .catch(() => {})
      .finally(() => setAnalyzing(false))
  }, [tool.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleLabelChange = useCallback((nodeId: string, paramName: string, value: string) => {
    setFields((prev) => prev.map((f) =>
      f.nodeId === nodeId && f.paramName === paramName ? { ...f, label: value || undefined } : f
    ))
  }, [])

  const handleSave = async () => {
    const withEnabled = fields.map((f) => ({ ...f, enabled: enabledKeys.has(fieldKey(f)) }))
    const enabledOutputs = withEnabled.filter((f) => !f.isInput && f.enabled)
    if (!enabledOutputs.length) { setError('Select at least one output.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/tools/${tool.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          schemaJson: JSON.stringify(withEnabled),
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

      {analyzing && (
        <div className="flex items-center gap-2 text-zinc-600 text-xs">
          <ArrowClockwise size={12} className="animate-spin" /> Loading full schema…
        </div>
      )}

      {inputs.length > 0 && (
        <Section title={`Inputs (${inputs.length})`}>
          <SchemaTable fields={inputs} enabledKeys={enabledKeys} onToggle={handleToggle} onDefaultChange={handleDefaultChange} onLabelChange={handleLabelChange} />
        </Section>
      )}

      {outputs.length > 0 && (
        <Section title={`Outputs (${outputs.length})`}>
          <SchemaTable fields={outputs} enabledKeys={enabledKeys} onToggle={handleToggle} onDefaultChange={handleDefaultChange} onLabelChange={handleLabelChange} isOutputs />
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

      <ComfyOrgApiKeySection />
    </div>
  )
}

// ─── ComfyOrg API Key ─────────────────────────────────────────────────────────

function ComfyOrgApiKeySection() {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    // Load from server-side storage; fall back to localStorage for backwards compat
    fetch('/api/settings/comfyorg-key')
      .then((r) => r.json())
      .then((data: { configured?: boolean }) => {
        if (!data.configured) {
          // Migrate from localStorage if present
          const local = getComfyOrgApiKey()
          if (local) {
            setKey(local)
          }
        }
      })
      .catch(() => {
        setKey(getComfyOrgApiKey())
      })
  }, [])

  const handleSave = async () => {
    const trimmed = key.trim()
    // Save server-side (used by SDK / API routes)
    await fetch('/api/settings/comfyorg-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: trimmed }),
    })
    // Also keep localStorage in sync (used by browser tool runner)
    setComfyOrgApiKey(trimmed)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleClear = async () => {
    setKey('')
    await fetch('/api/settings/comfyorg-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: '' }),
    })
    setComfyOrgApiKey('')
    setSaved(false)
  }

  return (
    <Section title="ComfyUI API Key">
      <div className="bg-white/5 rounded-xl p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Key size={16} className="text-zinc-400 mt-0.5 shrink-0" />
          <div className="space-y-2 flex-1 min-w-0">
            <p className="text-sm text-zinc-300">
              Required for workflows that use <span className="text-white font-medium">API nodes</span> (OpenAI, Stability, Flux, Kling, etc.).
              These nodes call external services through ComfyUI&apos;s API proxy and need a ComfyOrg API key for authentication.
            </p>

            {/* Input */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={show ? 'text' : 'password'}
                  value={key}
                  onChange={(e) => { setKey(e.target.value); setSaved(false) }}
                  placeholder="comfyui-xxxxxxxx..."
                  spellCheck={false}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {show ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button
                onClick={() => void handleSave()}
                disabled={!key.trim()}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors shrink-0"
              >
                {saved ? 'Saved' : 'Save'}
              </button>
              {key && (
                <button
                  onClick={handleClear}
                  className="px-3 py-2 text-sm text-zinc-400 hover:text-red-400 border border-zinc-700 hover:border-red-500/30 rounded-lg transition-colors shrink-0"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Instructions */}
            <details className="group">
              <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors select-none">
                How to get an API key
              </summary>
              <div className="mt-3 space-y-2 text-xs text-zinc-400 bg-zinc-900/50 rounded-lg p-3 border border-zinc-800">
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>
                    Go to{' '}
                    <a
                      href="https://platform.comfy.org/login"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                    >
                      platform.comfy.org
                    </a>{' '}
                    and sign in (or create an account)
                  </li>
                  <li>Navigate to <span className="text-zinc-300">API Keys</span> in the dashboard</li>
                  <li>Click <span className="text-zinc-300">Create API Key</span> and copy the generated key</li>
                  <li>Paste it above and click <span className="text-zinc-300">Save</span></li>
                </ol>
                <p className="pt-1.5 border-t border-zinc-800 text-zinc-500">
                  The key is stored locally in your browser and sent to ComfyUI with each workflow execution.
                  API node usage is billed through your ComfyOrg account.
                </p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </Section>
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
