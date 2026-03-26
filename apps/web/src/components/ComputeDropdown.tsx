'use client'

import { useState, useRef, useEffect } from 'react'
import { CaretDown, Check, Lightning, Cloud, Cpu } from 'phosphor-react'

export interface ComputeOption {
  value: string
  label: string
  disabled?: boolean
}

export interface ComputeGroup {
  label: string
  icon: 'local' | 'cloud'
  options: ComputeOption[]
}

interface ComputeDropdownProps {
  value: string
  onChange: (value: string) => void
  groups: ComputeGroup[]
}

function getSelectedLabel(groups: ComputeGroup[], value: string): string {
  for (const group of groups) {
    const opt = group.options.find((o) => o.value === value)
    if (opt) return opt.label
  }
  return 'Select…'
}

function getSelectedGroup(groups: ComputeGroup[], value: string): 'local' | 'cloud' {
  for (const group of groups) {
    if (group.options.some((o) => o.value === value)) return group.icon
  }
  return 'local'
}

export function ComputeDropdown({ value, onChange, groups }: ComputeDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const selectedLabel = getSelectedLabel(groups, value)
  const selectedIcon = getSelectedGroup(groups, value)

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex items-center gap-2 pl-2.5 pr-2 py-1.5 text-xs rounded-lg border transition-all',
          open
            ? 'bg-zinc-800 border-zinc-600 text-zinc-100'
            : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/80',
        ].join(' ')}
      >
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Compute</span>
        <span className="w-px h-3 bg-zinc-700" />
        {selectedIcon === 'cloud' ? (
          <Cloud size={12} weight="duotone" className="text-purple-400 shrink-0" />
        ) : (
          <Lightning size={12} weight="duotone" className="text-emerald-400 shrink-0" />
        )}
        <span className="truncate max-w-[140px]">{selectedLabel}</span>
        <CaretDown size={10} className={`text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-64 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
          {groups.map((group) => {
            if (group.options.length === 0) return null
            return (
              <div key={group.label}>
                {/* Group header */}
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                  {group.icon === 'cloud' ? (
                    <Cloud size={11} weight="duotone" className="text-purple-400/70" />
                  ) : (
                    <Lightning size={11} weight="duotone" className="text-emerald-400/70" />
                  )}
                  <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>

                {/* Options */}
                {group.options.map((opt) => {
                  const isSelected = opt.value === value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => {
                        if (!opt.disabled) {
                          onChange(opt.value)
                          setOpen(false)
                        }
                      }}
                      className={[
                        'w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors',
                        opt.disabled
                          ? 'text-zinc-600 cursor-not-allowed'
                          : isSelected
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : 'text-zinc-300 hover:bg-white/5 hover:text-zinc-100',
                      ].join(' ')}
                    >
                      {/* Checkmark column */}
                      <span className="w-3.5 shrink-0 flex items-center justify-center">
                        {isSelected && <Check size={12} weight="bold" className="text-emerald-400" />}
                      </span>
                      <span className="truncate flex-1">{opt.label}</span>
                      {opt.disabled && (
                        <span className="text-[9px] text-zinc-600 shrink-0">unavailable</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
