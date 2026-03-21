'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Infinity as InfinityIcon,
  Copy,
  CheckCircle,
  ArrowRight,
  Lightning,
  Cloud,
  CloudArrowUp,
  ArrowSquareOut,
  Key,
  Cpu,
  CircleNotch,
  FolderOpen,
  Warning,
  ArrowCounterClockwise,
} from 'phosphor-react'

interface GpuInfo {
  index: number
  name: string
  vramMB: number
  backend: 'cuda' | 'rocm'
}

interface CpuInfo {
  model: string
  cores: number
  threads: number
  ramGB: number
}

const STEPS = [
  { label: 'GPUs', icon: Lightning },
  { label: 'Cloud', icon: Cloud },
  { label: 'ComfyUI', icon: ArrowSquareOut },
  { label: 'Credentials', icon: Key },
] as const

function ProgressStepper({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((step, i) => {
        const Icon = step.icon
        const isActive = i === current
        const isDone = i < current
        return (
          <div key={step.label} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-8 transition-colors ${
                  isDone ? 'bg-emerald-500/60' : 'bg-white/10'
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`size-8 rounded-full flex items-center justify-center border transition-colors ${
                  isActive
                    ? 'border-emerald-500/50 bg-emerald-600/20 text-emerald-400'
                    : isDone
                      ? 'border-emerald-500/30 bg-emerald-600/10 text-emerald-500'
                      : 'border-white/10 bg-white/5 text-zinc-500'
                }`}
              >
                {isDone ? (
                  <CheckCircle size={16} weight="fill" />
                ) : (
                  <Icon size={14} weight={isActive ? 'fill' : 'regular'} />
                )}
              </div>
              <span
                className={`text-[10px] font-medium transition-colors ${
                  isActive ? 'text-emerald-400' : isDone ? 'text-zinc-400' : 'text-zinc-600'
                }`}
              >
                {step.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ─── Step 1: GPU Detection ─── */
function StepGpus({ onNext }: { onNext: () => void }) {
  const [gpus, setGpus] = useState<GpuInfo[]>([])
  const [cpu, setCpu] = useState<CpuInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const detect = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/setup/gpu', { method: 'POST' })
      if (!res.ok) throw new Error('Detection failed')
      const data = await res.json()
      setGpus(data.gpus ?? [])
      setCpu(data.cpu ?? null)
    } catch {
      setError('Could not detect hardware. You can continue anyway.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    detect()
  }, [detect])

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1 font-tech">Your GPUs</h1>
      <p className="text-sm text-zinc-400 mb-6">
        Detected compute devices on this machine.
      </p>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <CircleNotch size={28} className="text-emerald-400 animate-spin" />
          <span className="text-sm text-zinc-400">Detecting hardware...</span>
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {error && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
              <p className="text-xs text-amber-400">{error}</p>
            </div>
          )}

          {gpus.length > 0 ? (
            gpus.map((gpu) => (
              <div
                key={gpu.index}
                className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-3"
              >
                <Lightning size={18} weight="fill" className="text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{gpu.name}</p>
                  <p className="text-xs text-zinc-500">
                    {Math.round(gpu.vramMB / 1024)} GB VRAM
                  </p>
                </div>
                <span
                  className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full ${
                    gpu.backend === 'cuda'
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}
                >
                  {gpu.backend.toUpperCase()}
                </span>
              </div>
            ))
          ) : (
            !error && (
              <div className="text-center py-4">
                <p className="text-sm text-zinc-500">No dedicated GPUs detected.</p>
                <p className="text-xs text-zinc-600 mt-1">
                  ComfyUI will run on CPU (slower).
                </p>
              </div>
            )
          )}

          {cpu && (
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
              <Cpu size={18} className="text-zinc-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{cpu.model}</p>
                <p className="text-xs text-zinc-500">
                  {cpu.cores} cores / {cpu.threads} threads &middot; {cpu.ramGB} GB RAM
                </p>
              </div>
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                CPU
              </span>
            </div>
          )}
        </div>
      )}

      <button
        onClick={onNext}
        disabled={loading}
        className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
      >
        Continue
        <ArrowRight size={16} />
      </button>
    </div>
  )
}

/* ─── Step 2: Cloud Compute ─── */
function StepCloud({ onNext }: { onNext: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'installing' | 'authenticating' | 'connected' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<string | null>(null)

  // Poll for status during auth
  useEffect(() => {
    if (phase !== 'authenticating') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/setup/modal')
        if (!res.ok) return
        const data = await res.json()
        if (data.authenticated) {
          setPhase('connected')
          setWorkspace(data.workspace ?? 'default')
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [phase])

  // Check if already connected on mount
  useEffect(() => {
    fetch('/api/setup/modal')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.authenticated) {
          setPhase('connected')
          setWorkspace(data.workspace ?? 'default')
        }
      })
      .catch(() => {})
  }, [])

  async function handleLogin() {
    setErrorMsg(null)
    try {
      // Check if installed first
      const statusRes = await fetch('/api/setup/modal')
      const status = statusRes.ok ? await statusRes.json() : { installed: false }

      if (!status.installed) {
        setPhase('installing')
        const installRes = await fetch('/api/setup/modal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'install' }),
        })
        const installData = await installRes.json()
        if (!installData.success) {
          setPhase('error')
          setErrorMsg(installData.error || 'Failed to install Modal CLI')
          return
        }
      }

      setPhase('authenticating')
      await fetch('/api/setup/modal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'authenticate' }),
      })
      // Polling will detect completion
    } catch (err: any) {
      setPhase('error')
      setErrorMsg(err.message || 'Setup failed')
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1 font-tech">Cloud Compute</h1>
      <p className="text-sm text-zinc-400 mb-6">Connect Modal.com for cloud GPU access.</p>

      <div className={`border rounded-lg p-5 mb-6 ${phase === 'connected' ? 'bg-purple-500/5 border-purple-500/20' : 'bg-white/5 border-white/10'}`}>
        <div className="flex items-start gap-3 mb-4">
          <div className="size-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
            <Cloud size={20} weight="fill" className="text-purple-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-white">Modal.com</h3>
              {phase === 'connected' && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/20">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  Connected
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {phase === 'connected'
                ? `Workspace: ${workspace}`
                : 'Run tools on A100, H100, and more. No hardware required.'}
            </p>
          </div>
        </div>

        {phase === 'idle' && (
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white font-medium py-2.5 px-4 rounded-lg transition-all"
          >
            <CloudArrowUp size={16} />
            Login with Modal
          </button>
        )}

        {phase === 'installing' && (
          <div className="flex items-center gap-2 py-2.5 px-4 rounded-lg bg-zinc-900/50 border border-white/5">
            <CircleNotch size={14} className="animate-spin text-purple-400" />
            <span className="text-sm text-zinc-300">Installing Modal CLI...</span>
          </div>
        )}

        {phase === 'authenticating' && (
          <div className="flex items-center gap-2 py-2.5 px-4 rounded-lg bg-zinc-900/50 border border-white/5">
            <CircleNotch size={14} className="animate-spin text-purple-400" />
            <span className="text-sm text-zinc-300">Waiting for browser authentication...</span>
          </div>
        )}

        {phase === 'connected' && (
          <div className="flex items-center gap-2">
            <CheckCircle size={16} weight="fill" className="text-emerald-400" />
            <span className="text-sm text-emerald-400">Modal is ready to use</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-950/30 border border-red-500/20">
              <Warning size={14} className="text-red-400 shrink-0" />
              <span className="text-xs text-red-300">{errorMsg}</span>
            </div>
            <button
              onClick={() => { setPhase('idle'); setErrorMsg(null) }}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <ArrowCounterClockwise size={12} />
              Retry
            </button>
          </div>
        )}
      </div>

      <button
        onClick={onNext}
        className={`flex items-center justify-center gap-2 w-full font-medium py-2.5 px-4 rounded-lg transition-colors border ${
          phase === 'connected'
            ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
            : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-white/10'
        }`}
      >
        {phase === 'connected' ? 'Continue' : 'Skip for now'}
        <ArrowRight size={16} />
      </button>
    </div>
  )
}

/* ─── Step 3: ComfyUI Path ─── */
function StepComfyUI({ onNext }: { onNext: () => void }) {
  const [path, setPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleBrowse() {
    if (typeof window !== 'undefined' && window.desktop?.dialog?.openDirectory) {
      const result = await window.desktop.dialog.openDirectory()
      if (result) {
        try {
          const parsed = JSON.parse(result)
          if (typeof parsed === 'string') setPath(parsed)
          else if (Array.isArray(parsed) && parsed.length > 0) setPath(parsed[0])
        } catch {
          setPath(result)
        }
      }
    }
  }

  async function handleSave() {
    if (!path.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/setup/comfyui-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comfyuiPath: path.trim() }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSaved(true)
      setTimeout(() => onNext(), 600)
    } catch {
      setError('Failed to save ComfyUI path.')
    } finally {
      setSaving(false)
    }
  }

  const isDesktop = typeof window !== 'undefined' && !!window.desktop

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1 font-tech">ComfyUI</h1>
      <p className="text-sm text-zinc-400 mb-6">
        Set the path to your local ComfyUI installation. You can change this later in Settings.
      </p>

      <div className="space-y-3 mb-6">
        <div>
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            Installation Path
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                setSaved(false)
              }}
              placeholder="/home/user/ComfyUI"
              className="flex-1 bg-white/5 border border-zinc-800 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder:text-zinc-600 outline-none transition-colors"
            />
            {isDesktop && (
              <button
                onClick={handleBrowse}
                className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2.5 px-3 rounded-lg transition-colors border border-zinc-700/50"
              >
                <FolderOpen size={16} />
                Browse
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onNext}
          className="flex-1 flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-medium py-2.5 px-4 rounded-lg transition-colors border border-white/10"
        >
          Skip
        </button>
        <button
          onClick={handleSave}
          disabled={!path.trim() || saving}
          className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
        >
          {saved ? (
            <>
              <CheckCircle size={16} weight="fill" />
              Saved
            </>
          ) : saving ? (
            <>
              <CircleNotch size={16} className="animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Save & Continue
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

/* ─── Step 4: Admin Credentials ─── */
function StepCredentials({ password }: { password: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1 font-tech">Admin Credentials</h1>
      <p className="text-sm text-zinc-400 mb-6">
        Your admin account has been created. Save these credentials — this screen will not appear
        again after you log in.
      </p>

      <div className="space-y-4 mb-6">
        <div>
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            Username
          </label>
          <div className="mt-1 flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
            <span className="text-white font-mono flex-1">admin</span>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            Password
          </label>
          <div className="mt-1 flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
            <span className="text-emerald-400 font-mono flex-1 tracking-widest">{password}</span>
            <button
              onClick={handleCopy}
              className="text-zinc-400 hover:text-white transition-colors shrink-0"
              title="Copy password"
            >
              {copied ? (
                <CheckCircle size={16} weight="fill" className="text-emerald-400" />
              ) : (
                <Copy size={16} />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 mb-6">
        <p className="text-xs text-amber-400">
          Change your password after logging in via the Users page.
        </p>
      </div>

      <Link
        href="/login"
        className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
      >
        Go to Login
        <ArrowRight size={16} />
      </Link>
    </div>
  )
}

/* ─── Main Wizard ─── */
export default function SetupView({ password }: { password: string }) {
  const [step, setStep] = useState(0)

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="size-10 rounded-xl bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
            <InfinityIcon size={24} weight="bold" className="text-emerald-500" />
          </div>
          <span className="font-tech text-xl font-bold text-white tracking-tight">FlowScale</span>
        </div>

        {/* Progress Stepper */}
        <ProgressStepper current={step} />

        {/* Card */}
        <div className="bg-[var(--color-background-panel)] border border-white/5 rounded-2xl p-8">
          {step === 0 && <StepGpus onNext={() => setStep(1)} />}
          {step === 1 && <StepCloud onNext={() => setStep(2)} />}
          {step === 2 && <StepComfyUI onNext={() => setStep(3)} />}
          {step === 3 && <StepCredentials password={password} />}
        </div>
      </div>
    </div>
  )
}
