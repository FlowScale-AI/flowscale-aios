import { resolveComfyBaseUrl } from '@/lib/modal-comfyui'

// ── Image input resolution ────────────────────────────────────────────────────
//
// Tool/app input image fields accept one of three forms:
//   - A base64 data URL ("data:image/png;base64,...")  →  uploaded to ComfyUI input dir
//   - An output reference ({ __comfy_output__: { filename, subfolder } })
//     →  fetched from ComfyUI output dir and re-uploaded to input dir for chaining
//   - A plain string filename  →  passed through as-is (already uploaded previously)
//
// Used by both the public tool-execution route and the bridge tools/run route
// to guarantee the image lands in the same ComfyUI instance that will execute
// the prompt — critical for multi-instance setups where input directories are
// not shared.

export type OutputRef = { __comfy_output__: { filename: string; subfolder: string } }

export function isDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('data:')
}

export function isOutputRef(v: unknown): v is OutputRef {
  return typeof v === 'object' && v !== null && '__comfy_output__' in v
}

/**
 * Resolves a single image-input value against a ComfyUI instance. Data URLs
 * and output refs are uploaded to the instance's input dir and replaced with
 * the returned server-side filename; plain strings are returned unchanged.
 */
export async function resolveImageInput(value: unknown, comfyPort: number): Promise<string> {
  const baseUrl = resolveComfyBaseUrl(comfyPort)

  if (isDataUrl(value)) {
    const [header, b64] = value.split(',')
    const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/png'
    const ext = mime.split('/')[1] ?? 'png'
    const buffer = Buffer.from(b64, 'base64')
    const filename = `upload_${Date.now()}.${ext}`

    const form = new FormData()
    form.append('image', new Blob([buffer], { type: mime }), filename)
    const res = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form })
    if (!res.ok) throw new Error('Failed to upload image to ComfyUI')
    const { name } = await res.json() as { name: string }
    return name
  }

  if (isOutputRef(value)) {
    const { filename, subfolder } = value.__comfy_output__
    const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(filename)}&type=output`
      + (subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : '')
    const fetchRes = await fetch(viewUrl)
    if (!fetchRes.ok) throw new Error(`Failed to fetch ComfyUI output: ${filename}`)
    const buf = await fetchRes.arrayBuffer()

    const form = new FormData()
    form.append('image', new Blob([buf], { type: 'image/png' }), filename)
    const uploadRes = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form })
    if (!uploadRes.ok) throw new Error('Failed to re-upload image to ComfyUI')
    const { name } = await uploadRes.json() as { name: string }
    return name
  }

  return value as string
}
