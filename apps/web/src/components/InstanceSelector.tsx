"use client"

import { useState, useRef, useEffect } from "react"
import { CaretDown } from "phosphor-react"

interface Instance {
  id: string
  status: string
  port: number
  device: string
  label: string
}

interface InstanceSelectorProps {
  instances: Instance[]
  value: number | "auto" | null
  onChange: (value: number | "auto") => void
  /** Compact mode for tight layouts like the canvas toolbar */
  compact?: boolean
}

export function InstanceSelector({ instances, value, onChange, compact = false }: InstanceSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const running = instances.filter((i) => i.status === "running")
  const showAuto = running.length > 1

  const selected = value === "auto" || value === null
    ? (showAuto ? "auto" : instances[0]?.id)
    : String(value)

  const selectedLabel = selected === "auto"
    ? "Auto"
    : instances.find((i) => String(i.port) === selected)?.label ?? "Select"

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
        className={`flex items-center gap-1 rounded transition-colors ${
          compact
            ? "px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200 max-w-[120px]"
            : "px-2 py-2 text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-600 rounded-md"
        }`}
      >
        <span className="truncate">{selectedLabel}</span>
        <CaretDown size={compact ? 10 : 12} className="shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 min-w-[220px] bg-zinc-900 border border-white/10 rounded-lg shadow-2xl py-1 z-50">
          {showAuto && (
            <button
              onClick={() => { onChange("auto"); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                selected === "auto"
                  ? "text-white bg-white/10"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              Auto
            </button>
          )}
          {instances.map((inst) => {
            const isDisabled = inst.status !== "running"
            const isSelected = String(inst.port) === selected
            return (
              <button
                key={inst.id}
                disabled={isDisabled}
                onClick={() => { onChange(inst.port); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  isDisabled
                    ? "text-zinc-600 cursor-not-allowed"
                    : isSelected
                      ? "text-white bg-white/10"
                      : "text-zinc-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {inst.label} (:{inst.port}){" "}
                {isDisabled && <span className="text-zinc-600">— {inst.status}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
