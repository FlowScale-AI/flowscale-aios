# Training UX Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the cloud compute picker for training tools (remove deployment management UI) and auto-start/stop the captioning server when users click "Auto-Caption All".

**Architecture:** Two independent UI+backend changes. The compute picker cleanup is frontend-only — hide the deploy banner and replace deployment-listing dropdown with a single "Cloud" option for training plugins. The auto-captioning change modifies the caption API route to auto-start/stop the inference server, with a new SSE `status` event for frontend progress.

**Tech Stack:** Next.js (React), TypeScript, Node.js child_process (localInference.ts)

**Spec:** `docs/superpowers/specs/2026-03-26-training-ux-cleanup.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/web/src/app/(main)/apps/[id]/page.tsx` | Modify | Simplify Cloud optgroup for training plugins; hide ModalDeployBanner for training plugins |
| `apps/web/src/app/api/training/datasets/[id]/caption/route.ts` | Modify | Auto-start server before captioning, stop after; stream status events |
| `apps/web/src/components/training/CaptionProgress.tsx` | Modify | Handle `status` event type, show server startup message |

---

### Task 1: Simplify compute picker for training plugins

**Files:**
- Modify: `apps/web/src/app/(main)/apps/[id]/page.tsx`

- [ ] **Step 1: Simplify the Cloud optgroup for training plugins**

In `apps/web/src/app/(main)/apps/[id]/page.tsx`, find the API-engine branch of the compute picker (around line 1278, the `else` branch after the ComfyUI options). The current Cloud optgroup lists individual deployments:

```tsx
                  {(modalSupported || isModalSelected) && modalStatus?.authenticated && (
                    <optgroup label="Cloud (Modal)">
                      <option value="modal:auto">Cloud &middot; Auto-route</option>
                      {(modalDeployData?.deployments ?? [])
                        .filter(d => d.status === 'deployed')
                        .map((d) => (
                          <option key={d.id} value={`modal:${d.id}`}>
                            Cloud &middot; {d.name} ({d.gpu})
                          </option>
                        ))
                      }
                    </optgroup>
                  )}
```

Replace with:

```tsx
                  {(modalSupported || isModalSelected) && modalStatus?.authenticated && (
                    <optgroup label="Cloud (Modal)">
                      {isTrainingPlugin ? (
                        <option value="modal:auto">Cloud</option>
                      ) : (
                        <>
                          <option value="modal:auto">Cloud &middot; Auto-route</option>
                          {(modalDeployData?.deployments ?? [])
                            .filter(d => d.status === 'deployed')
                            .map((d) => (
                              <option key={d.id} value={`modal:${d.id}`}>
                                Cloud &middot; {d.name} ({d.gpu})
                              </option>
                            ))
                          }
                        </>
                      )}
                    </optgroup>
                  )}
```

- [ ] **Step 2: Hide ModalDeployBanner for training plugins**

Find the ModalDeployBanner render (around line 1359-1368):

```tsx
      {/* Modal deploy banner (API tools when Modal selected) */}
      {tool.engine === 'api' && isModalSelected && pluginId && modalSupported && (
        <ModalDeployBanner
```

Change the condition to exclude training plugins:

```tsx
      {/* Modal deploy banner (API tools when Modal selected — not training) */}
      {tool.engine === 'api' && isModalSelected && pluginId && modalSupported && !isTrainingPlugin && (
        <ModalDeployBanner
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(main)/apps/[id]/page.tsx
git commit -m "feat: simplify cloud compute picker for training tools"
```

---

### Task 2: Auto-start/stop captioning server in API route

**Files:**
- Modify: `apps/web/src/app/api/training/datasets/[id]/caption/route.ts`

- [ ] **Step 1: Add imports for server lifecycle functions**

At the top of `apps/web/src/app/api/training/datasets/[id]/caption/route.ts`, update imports:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDataset, getDatasetDir } from '@/lib/training'
import { scanPlugins } from '@/lib/toolPlugins'
import { isServerRunning, resolvePython, areDepsInstalled, spawnServer, stopServer } from '@/lib/localInference'
import { join } from 'path'
import { writeFileSync } from 'fs'
```

- [ ] **Step 2: Add a helper to wait for the server to become healthy**

Add after `findCaptioningPlugin()`:

```typescript
async function waitForServer(pluginId: string, timeoutMs: number = 120_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning(pluginId)) return true
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}
```

- [ ] **Step 3: Rewrite the POST handler to auto-start/stop the server**

Replace the entire `POST` function body with:

```typescript
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const dataset = getDataset(id)
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const body = await req.json() as { mode?: 'detailed' | 'brief' }
  const mode = body.mode ?? 'detailed'

  const captioner = findCaptioningPlugin()
  if (!captioner) {
    return NextResponse.json({ error: 'No training plugin installed. Install a LoRA trainer first.' }, { status: 400 })
  }

  const dir = getDatasetDir(id)
  const images = dataset.images.map((img) => ({
    path: join(dir, img.name),
    mode,
  }))

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let serverWasStarted = false

      const emit = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        // Auto-start server if not running
        const alreadyRunning = await isServerRunning(captioner.pluginId)
        if (!alreadyRunning) {
          const python = resolvePython()
          if (!areDepsInstalled(python, captioner.pluginId)) {
            emit({ type: 'error', message: 'Dependencies not installed. Install from the tool page first.' })
            controller.close()
            return
          }

          emit({ type: 'status', message: 'Starting captioning server...' })
          spawnServer(python, captioner.pluginId)
          serverWasStarted = true

          const ready = await waitForServer(captioner.pluginId)
          if (!ready) {
            emit({ type: 'error', message: 'Captioning server failed to start within 120s' })
            controller.close()
            return
          }
        }

        // Run captioning
        const res = await fetch(`http://127.0.0.1:${captioner.port}/caption/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images }),
        })

        if (!res.ok || !res.body) {
          emit({ type: 'error', message: 'Captioning request failed' })
          controller.close()
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          controller.enqueue(encoder.encode(text))

          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as { type: string; imageName?: string; caption?: string }
              if (event.type === 'caption' && event.imageName && event.caption) {
                const baseName = event.imageName.substring(0, event.imageName.lastIndexOf('.'))
                writeFileSync(join(dir, `${baseName}.txt`), event.caption)
              }
            } catch { /* skip */ }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Captioning error'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`))
      } finally {
        // Stop server if we started it
        if (serverWasStarted) {
          try { await stopServer(captioner.pluginId) } catch { /* non-fatal */ }
        }
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/training/datasets/[id]/caption/route.ts
git commit -m "feat: auto-start/stop captioning server on Auto-Caption All"
```

---

### Task 3: Handle status events in CaptionProgress component

**Files:**
- Modify: `apps/web/src/components/training/CaptionProgress.tsx`

- [ ] **Step 1: Add status state and handle the `status` event type**

In `CaptionProgress.tsx`, add a `statusMessage` state after the existing state declarations (around line 16):

```typescript
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
```

In the `handleCaption` function, inside the SSE parsing loop (around line 46-57), add handling for the `status` event type. Replace:

```typescript
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; message?: string }
            if (event.type === 'caption') {
              captionCount++
              setProgress(totalImages > 0 ? Math.min(captionCount / totalImages, 1) : 0)
            } else if (event.type === 'error') {
              setError(event.message ?? 'Captioning error')
            }
          } catch { /* skip malformed */ }
        }
```

with:

```typescript
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; message?: string }
            if (event.type === 'status') {
              setStatusMessage(event.message ?? null)
            } else if (event.type === 'caption') {
              setStatusMessage(null)
              captionCount++
              setProgress(totalImages > 0 ? Math.min(captionCount / totalImages, 1) : 0)
            } else if (event.type === 'error') {
              setError(event.message ?? 'Captioning error')
            }
          } catch { /* skip malformed */ }
        }
```

Also clear `statusMessage` at the start of `handleCaption` (after `setError(null)`):

```typescript
    setStatusMessage(null)
```

- [ ] **Step 2: Show the status message in the progress area**

In the render section, find the progress bar area (around line 125-138). Replace:

```tsx
      {/* Progress bar */}
      {(running || progress > 0) && (
        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
            <span>{running ? 'Captioning…' : 'Done'}</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}
```

with:

```tsx
      {/* Status / Progress */}
      {running && statusMessage && progress === 0 && (
        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
          <SpinnerGap size={12} className="animate-spin text-violet-400" />
          {statusMessage}
        </div>
      )}
      {((!statusMessage && running) || progress > 0) && (
        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
            <span>{running ? 'Captioning…' : 'Done'}</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/training/CaptionProgress.tsx
git commit -m "feat: show server startup status in caption progress UI"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] Compute picker for training tools shows single "Cloud" option (not individual deployments)
- [ ] ModalDeployBanner is hidden when a training tool has Cloud selected
- [ ] Non-training API tools still show deployment list and banner as before
- [ ] GPU tier picker still appears when Cloud is selected for training
- [ ] "Auto-Caption All" auto-starts the server if not running
- [ ] A "Starting captioning server..." message appears during startup
- [ ] Captioning proceeds normally after server is ready
- [ ] Server is stopped after captioning completes
- [ ] If deps aren't installed, user gets a clear error message
- [ ] `pnpm typecheck` passes
