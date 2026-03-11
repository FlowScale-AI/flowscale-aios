import type { WorkflowIO } from '../types'
import { ImageUpload } from './ImageUpload'

const IMAGE_NODE_TYPES = ['LoadImage', 'FSLoadImage', 'FSLoadAudio', 'VHS_LoadVideo', 'LoadImageMask']

interface Props {
  field: WorkflowIO
  value: unknown
  comfyPort: number | undefined
  onChange: (key: string, value: unknown) => void
}

export function InputField({ field, value, comfyPort, onChange }: Props) {
  const key = `${field.nodeId}__${field.paramName}`
  // paramName is always the most specific label (e.g. "brightness", "prompt").
  // nodeTitle is the node-level label ("Enhancer", "Z-Image Turbo") — shown as
  // a secondary context badge instead.
  const label = field.paramName
    .replace(/^api__/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  const context = field.nodeTitle !== field.nodeType ? field.nodeTitle : null

  const isImageInput =
    field.paramType === 'image' || IMAGE_NODE_TYPES.includes(field.nodeType)

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-zinc-400">
        {label}
        {context && (
          <span className="ml-1.5 text-zinc-600 font-normal">{context}</span>
        )}
      </label>

      {isImageInput ? (
        <ImageUpload
          comfyPort={comfyPort}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(key, v)}
        />
      ) : field.paramType === 'select' ? (
        <select
          value={(value as string) ?? ''}
          onChange={(e) => onChange(key, e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
        >
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : field.paramType === 'boolean' ? (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(key, e.target.checked)}
            className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
          />
          <span className="text-sm text-zinc-300">{label}</span>
        </label>
      ) : field.paramType === 'number' ? (
        <input
          type="number"
          value={(value as number) ?? (field.defaultValue as number) ?? 0}
          onChange={(e) => onChange(key, Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
        />
      ) : (
        // string — use textarea for prompt-like fields
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(key, e.target.value)}
          rows={field.nodeTitle?.toLowerCase().includes('prompt') ? 3 : 1}
          className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
        />
      )}
    </div>
  )
}
