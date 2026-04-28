"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { CaretDown, Lightning, Cpu, Cloud } from "phosphor-react"
import { getInstanceDisplayLabel } from "@/lib/instanceLabel"
import { useGpuAvailability, isDeviceAvailable, deviceKeyForInstance } from "@/lib/gpuAvailability"

interface ComputeInstance {
  id: string
  status: string
  port: number
  device: string
  label: string
  gpuName?: string
  customLabel?: string
}

interface GpuInfoItem {
  index: number
  name: string
  vramMB: number
  backend: string
}

export interface ComputePickerProps {
  instances: ComputeInstance[]
  gpuInfo?: GpuInfoItem[]
  value: number | "auto" | "modal" | null
  onChange: (value: number | "auto" | "modal") => void
  /** Compact mode for tight layouts like the canvas toolbar */
  compact?: boolean
  /** Whether Modal cloud compute is connected */
  modalConnected?: boolean
  /** Whether this tool's plugin supports Modal deployment */
  modalSupported?: boolean
}

function formatVram(mb: number): string {
  const gb = mb / 1024
  return gb >= 1 ? `${gb.toFixed(gb % 1 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

function matchGpuToInstance(
  instance: ComputeInstance,
  gpuInfo?: GpuInfoItem[]
): GpuInfoItem | undefined {
  if (!gpuInfo || gpuInfo.length === 0) return undefined
  const match = instance.device.match(/gpu-(\d+)/)
  if (match) {
    const idx = parseInt(match[1], 10)
    return gpuInfo.find((g) => g.index === idx)
  }
  return undefined
}

export function ComputePicker({
  instances: rawInstances,
  gpuInfo,
  value,
  onChange,
  compact = false,
  modalConnected = false,
  modalSupported = false,
}: ComputePickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const gpuAvailability = useGpuAvailability()
  // Hide instances backed by a device the user disabled in Compute settings.
  // External instances (device "external" or anything we can't map) are never
  // filtered — the user didn't bring those up via AIOS.
  const instances = rawInstances.filter((i) => {
    const key = deviceKeyForInstance(i.device)
    return key == null || isDeviceAvailable(key, gpuAvailability)
  })
  const running = instances.filter((i) => i.status === "running")
  const showAuto = running.length > 1

  const selected =
    value === "modal"
      ? "modal"
      : value === "auto" || value === null
      ? showAuto
        ? "auto"
        : instances[0]?.id
      : String(value)

  const selectedLabel = (() => {
    if (selected === "modal") return "Modal (Cloud)"
    if (selected === "auto") return "Auto"
    const inst = instances.find((i) => String(i.port) === selected)
    return inst ? getInstanceDisplayLabel(inst) : "Select"
  })()

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded transition-colors ${
          compact
            ? "px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200 max-w-[140px]"
            : "px-2.5 py-2 text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-600 rounded-lg"
        }`}
      >
        {!compact && (
          selected === "modal" ? (
            <Cloud
              size={13}
              weight="duotone"
              className="shrink-0 text-purple-400"
            />
          ) : (
            <Cpu
              size={13}
              weight="duotone"
              className="shrink-0 text-emerald-400"
            />
          )
        )}
        <span className="truncate">{selectedLabel}</span>
        <CaretDown
          size={compact ? 10 : 12}
          className="shrink-0 opacity-50"
        />
      </button>

      {open && (
        <div
          className={`absolute right-0 min-w-[280px] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-1.5 z-50 ${
            compact ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {/* Auto option */}
          {showAuto && (
            <button
              onClick={() => {
                onChange("auto")
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                selected === "auto"
                  ? "text-emerald-400 bg-emerald-500/10"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Lightning
                size={14}
                weight="fill"
                className={
                  selected === "auto" ? "text-emerald-400" : "text-zinc-500"
                }
              />
              <span className="font-medium">Auto</span>
              <span className="ml-auto text-[10px] text-zinc-500">
                {running.length} instances
              </span>
            </button>
          )}

          {/* Separator */}
          {showAuto && instances.length > 0 && (
            <div className="h-px bg-white/5 my-1" />
          )}

          {/* Local instances */}
          {instances.map((inst) => {
            const isDisabled = inst.status !== "running"
            const isSelected = String(inst.port) === selected
            const gpu = matchGpuToInstance(inst, gpuInfo)
            const isCpu = inst.device === "cpu"

            return (
              <button
                key={inst.id}
                disabled={isDisabled}
                onClick={() => {
                  onChange(inst.port)
                  setOpen(false)
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  isDisabled
                    ? "opacity-40 cursor-not-allowed"
                    : isSelected
                    ? "bg-emerald-500/10"
                    : "hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-2">
                  {isCpu ? (
                    <Cpu
                      size={14}
                      weight="duotone"
                      className={
                        isSelected ? "text-emerald-400" : "text-zinc-500"
                      }
                    />
                  ) : (
                    <Lightning
                      size={14}
                      weight="duotone"
                      className={
                        isSelected ? "text-emerald-400" : "text-zinc-500"
                      }
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-medium truncate ${
                          isDisabled
                            ? "text-zinc-600"
                            : isSelected
                            ? "text-emerald-400"
                            : "text-zinc-200"
                        }`}
                      >
                        {getInstanceDisplayLabel(inst)}
                      </span>
                      <span className="text-[10px] text-zinc-600 shrink-0">
                        :{inst.port}
                      </span>
                    </div>

                    {/* VRAM label for GPU instances */}
                    {gpu && !isDisabled && (
                      <span className="text-[10px] text-zinc-500 mt-1">
                        {formatVram(gpu.vramMB)} VRAM
                      </span>
                    )}

                    {isDisabled && (
                      <span className="text-[10px] text-zinc-600">
                        {inst.status}
                      </span>
                    )}
                  </div>

                  {/* Local badge */}
                  {!isDisabled && (
                    <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-medium rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Local
                    </span>
                  )}
                </div>
              </button>
            )
          })}

          {/* Cloud option */}
          <div className="h-px bg-white/5 my-1" />
          {modalConnected && modalSupported ? (
            <button
              onClick={() => {
                onChange("modal")
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                selected === "modal"
                  ? "text-purple-400 bg-purple-500/10"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Cloud
                size={14}
                weight="duotone"
                className="text-purple-400"
              />
              <span className="font-medium">Modal (Cloud)</span>
              <span className="ml-auto shrink-0 px-1.5 py-0.5 text-[9px] font-medium rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                Cloud
              </span>
            </button>
          ) : modalSupported && !modalConnected ? (
            <Link
              href="/settings?tab=compute"
              onClick={() => setOpen(false)}
              className="block w-full px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Cloud size={14} weight="duotone" className="text-purple-400 opacity-50" />
                <span>Connect Modal in Settings &rarr;</span>
              </div>
            </Link>
          ) : null}

          {/* Custom Cloud — CTAs, not selectable compute targets. Uses
              window.desktop.shell.openExternal in Electron because the
              will-navigate handler blocks non-http clicks in the renderer;
              falls back to direct navigation in the browser. */}
          <div className="h-px bg-white/5 my-1" />
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
            Custom Cloud
          </div>
          <button
            type="button"
            onClick={() => {
              const mailto =
                "mailto:aman@flowscale.ai?subject=Custom%20cloud%20setup%20for%20FlowScale%20AI%20OS"
              if (typeof window !== "undefined" && window.desktop?.shell?.openExternal) {
                window.desktop.shell.openExternal(mailto)
              } else {
                window.location.href = mailto
              }
              setOpen(false)
            }}
            className="w-full text-left px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Cloud size={14} weight="duotone" className="text-zinc-500" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-zinc-300">aman@flowscale.ai</div>
                <div className="text-[10px] text-zinc-600 mt-0.5 truncate">
                  Bring your own cloud — get in touch
                </div>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              const url = "https://discord.gg/XgPTrNM7Du"
              if (typeof window !== "undefined" && window.desktop?.shell?.openExternal) {
                window.desktop.shell.openExternal(url)
              } else {
                window.open(url, "_blank", "noopener,noreferrer")
              }
              setOpen(false)
            }}
            className="w-full text-left px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Cloud size={14} weight="duotone" className="text-zinc-500" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-zinc-300">Join Discord</div>
                <div className="text-[10px] text-zinc-600 mt-0.5 truncate">
                  discord.gg/XgPTrNM7Du
                </div>
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
