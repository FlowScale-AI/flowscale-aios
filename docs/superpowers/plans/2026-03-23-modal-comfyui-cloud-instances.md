# Modal ComfyUI Cloud Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy ComfyUI on Modal as shared cloud infrastructure, accessible from all ComfyUI-engine tools via virtual port mapping with full WebSocket support.

**Architecture:** Modal ComfyUI instances run as serverless apps with a reverse ASGI proxy to an internal ComfyUI subprocess. Virtual ports (50001-50999) map to Modal URLs via a central `resolveComfyBaseUrl()` function. All 7 direct localhost references across 3 files are updated to use this resolver. The existing proxy, execution, and WebSocket flows work unchanged.

**Tech Stack:** Modal Python SDK, Next.js API routes, React, ASGI (Starlette), child_process

**Spec:** `docs/superpowers/specs/2026-03-23-modal-comfyui-cloud-instances-design.md`

---

## File Structure

### New files
| File | Purpose |
|------|---------|
| `apps/web/src/lib/modal-comfyui.ts` | Instance manager, virtual port mapping, `resolveComfyBaseUrl()` |
| `apps/web/src/app/api/modal/comfyui/route.ts` | Deploy/undeploy/list API |
| `apps/web/src/app/api/modal/comfyui/scan/route.ts` | Scan local ComfyUI installation |
| `apps/web/src/hooks/useModalComfyInstances.ts` | Hook for fetching Modal ComfyUI instances |
| `apps/web/src/components/ModalComfySection.tsx` | Cloud Instances UI for Settings > ComfyUI tab |

### Modified files
| File | Change |
|------|--------|
| `apps/web/src/app/api/comfy/[port]/[...path]/route.ts` | Use `resolveComfyBaseUrl`, longer timeout for Modal |
| `apps/web/src/app/api/comfy/[port]/ws/route.ts` | Use `resolveComfyBaseUrl` for WS URL |
| `apps/web/src/app/api/tools/[id]/executions/route.ts` | Use `resolveComfyBaseUrl` for all 4 localhost refs, allow virtual ports |
| `apps/web/src/app/(main)/settings/page.tsx` | Add ModalComfySection to ComfyUI tab |
| `apps/web/src/app/(main)/apps/[id]/page.tsx` | Provider/target dropdowns for ComfyUI tools |
| `apps/web/scripts/modal-helper.py` | Add `deploy-comfyui` and `scan-comfyui` commands |

---

## Task 1: Create `modal-comfyui.ts` — instance manager and URL resolver

**Files:**
- Create: `apps/web/src/lib/modal-comfyui.ts`

- [ ] **Step 1: Create the module**

```ts
/**
 * Modal ComfyUI instance manager.
 *
 * Manages shared ComfyUI instances on Modal (one or more instances
 * serving all ComfyUI-engine tools). Uses virtual port mapping
 * (50001-50999) so the existing proxy and execution routes work unchanged.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModalComfyInstance {
  id: string
  name: string
  status: 'deploying' | 'deployed' | 'error'
  errorMessage?: string
  gpu: string
  virtualPort: number
  appName: string
  url: string
  deployedAt: number
}

// ── Constants ────────────────────────────────────────────────────────────────

const MODAL_COMFY_PORT_BASE = 50000
const MODAL_COMFY_PORT_MAX = 50999
const AIOS_DIR = join(homedir(), '.flowscale', 'aios')
const INSTANCES_FILE = join(AIOS_DIR, 'modal-comfyui.json')

// ── Persistence ──────────────────────────────────────────────────────────────

function readInstances(): ModalComfyInstance[] {
  try {
    return JSON.parse(readFileSync(INSTANCES_FILE, 'utf-8')) as ModalComfyInstance[]
  } catch {
    return []
  }
}

function writeInstances(instances: ModalComfyInstance[]): void {
  mkdirSync(AIOS_DIR, { recursive: true })
  writeFileSync(INSTANCES_FILE, JSON.stringify(instances, null, 2), 'utf-8')
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getModalComfyInstances(): ModalComfyInstance[] {
  return readInstances()
}

export function getModalComfyByPort(port: number): ModalComfyInstance | null {
  return readInstances().find(i => i.virtualPort === port) ?? null
}

export function getModalComfyById(id: string): ModalComfyInstance | null {
  return readInstances().find(i => i.id === id) ?? null
}

export function isModalComfyPort(port: number): boolean {
  return port > MODAL_COMFY_PORT_BASE && port <= MODAL_COMFY_PORT_MAX
}

/** Central URL resolver — used by proxy, execution route, and WS bridge. */
export function resolveComfyBaseUrl(port: number): string {
  if (isModalComfyPort(port)) {
    const instance = getModalComfyByPort(port)
    if (!instance || instance.status !== 'deployed' || !instance.url) {
      throw new Error(`Modal ComfyUI instance for virtual port ${port} not found or not deployed`)
    }
    return instance.url
  }
  return `http://127.0.0.1:${port}`
}

/** Allocate next available virtual port (reuses freed ports). */
export function allocateVirtualPort(): number {
  const instances = readInstances()
  const usedPorts = new Set(instances.map(i => i.virtualPort))
  for (let port = MODAL_COMFY_PORT_BASE + 1; port <= MODAL_COMFY_PORT_MAX; port++) {
    if (!usedPorts.has(port)) return port
  }
  throw new Error('No more virtual ports available')
}

export function addModalComfyInstance(instance: ModalComfyInstance): void {
  const instances = readInstances()
  instances.push(instance)
  writeInstances(instances)
}

export function updateModalComfyInstance(id: string, updates: Partial<ModalComfyInstance>): void {
  const instances = readInstances()
  const idx = instances.findIndex(i => i.id === id)
  if (idx >= 0) {
    instances[idx] = { ...instances[idx], ...updates }
    writeInstances(instances)
  }
}

export function removeModalComfyInstance(id: string): void {
  const instances = readInstances().filter(i => i.id !== id)
  writeInstances(instances)
}

// Auto-routing for Modal ComfyUI instances
const _modalComfyRouteCounter = { value: 0 }

export function autoRouteModalComfy(): ModalComfyInstance | null {
  const deployed = readInstances().filter(i => i.status === 'deployed')
  if (deployed.length === 0) return null
  const idx = _modalComfyRouteCounter.value % deployed.length
  _modalComfyRouteCounter.value++
  return deployed[idx]
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/modal-comfyui.ts
git commit -m "feat: add Modal ComfyUI instance manager with virtual port mapping"
```

---

## Task 2: Update proxy route to use `resolveComfyBaseUrl`

**Files:**
- Modify: `apps/web/src/app/api/comfy/[port]/[...path]/route.ts`

- [ ] **Step 1: Import and use resolver**

Add import:
```ts
import { isModalComfyPort, resolveComfyBaseUrl } from '@/lib/modal-comfyui'
```

Replace the upstream URL construction (line ~12):
```ts
// Before:
const upstream = `http://127.0.0.1:${port}/${rawPath}${url.search}`

// After:
const baseUrl = resolveComfyBaseUrl(port)
const upstream = `${baseUrl}/${rawPath}${url.search}`
```

- [ ] **Step 2: Add longer timeout for Modal ports**

If there's a timeout/signal in the fetch, update for Modal:
```ts
const timeout = isModalComfyPort(port) ? 180_000 : 30_000
```

- [ ] **Step 3: Run typecheck and commit**

```bash
pnpm typecheck
git add apps/web/src/app/api/comfy/\[port\]/\[...path\]/route.ts
git commit -m "feat: proxy route resolves virtual ports to Modal URLs"
```

---

## Task 3: Update WebSocket bridge to use `resolveComfyBaseUrl`

**Files:**
- Modify: `apps/web/src/app/api/comfy/[port]/ws/route.ts`

- [ ] **Step 1: Import and update WS URL**

Add import:
```ts
import { isModalComfyPort, resolveComfyBaseUrl } from '@/lib/modal-comfyui'
```

Update the WebSocket connection (line ~12):
```ts
// Before:
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?clientId=${clientId}`)

// After:
const baseUrl = resolveComfyBaseUrl(port)
const wsProtocol = baseUrl.startsWith('https') ? 'wss' : 'ws'
const wsHost = new URL(baseUrl).host
const ws = new WebSocket(`${wsProtocol}://${wsHost}/ws?clientId=${clientId}`)
```

- [ ] **Step 2: Skip log subscription for Modal ports**

The HTTP PATCH to `/internal/logs/subscribe` (line ~16) is a ComfyUI Manager-specific endpoint. Skip for Modal:
```ts
if (!isModalComfyPort(port)) {
  // existing log subscription code
  fetch(`http://127.0.0.1:${port}/internal/logs/subscribe`, { method: 'PATCH' })
}
```

- [ ] **Step 3: Run typecheck and commit**

```bash
pnpm typecheck
git add apps/web/src/app/api/comfy/\[port\]/ws/route.ts
git commit -m "feat: WebSocket bridge supports Modal ComfyUI via wss://"
```

---

## Task 4: Update execution route to use `resolveComfyBaseUrl`

**Files:**
- Modify: `apps/web/src/app/api/tools/[id]/executions/route.ts`

- [ ] **Step 1: Import resolver**

```ts
import { isModalComfyPort, resolveComfyBaseUrl, getModalComfyByPort } from '@/lib/modal-comfyui'
```

- [ ] **Step 2: Update port validation (line ~276)**

```ts
// Before:
const validPorts = new Set(getComfyInstances().map((i) => i.port))
if (!validPorts.has(comfyPortOverride)) { ... }

// After:
const validPorts = new Set(getComfyInstances().map((i) => i.port))
const isValidModalComfyPort = isModalComfyPort(comfyPortOverride) && getModalComfyByPort(comfyPortOverride) != null
if (!validPorts.has(comfyPortOverride) && !isValidModalComfyPort) { ... }
```

- [ ] **Step 3: Update all 4 localhost references**

Replace all `http://localhost:${comfyPort}` with `resolveComfyBaseUrl(comfyPort)`:

1. **object_info fetch (~line 447):**
```ts
const infoRes = await fetch(`${resolveComfyBaseUrl(comfyPort)}/object_info`, { ... })
```

2. **prompt queue (~line 502):**
```ts
queueRes = await fetch(`${resolveComfyBaseUrl(comfyPort)}/prompt`, { ... })
```

3. **saveComfyOutputsToDisk (~line 35):**
```ts
const url = `${resolveComfyBaseUrl(comfyPort)}/view?filename=...`
```

4. **history poll (~line 547):**
```ts
const baseUrl = resolveComfyBaseUrl(comfyPort)
```

- [ ] **Step 4: Increase timeout for Modal ports in prompt queue**

Add a timeout override for Modal ports on the prompt fetch:
```ts
const fetchTimeout = isModalComfyPort(comfyPort) ? 180_000 : undefined
```

- [ ] **Step 5: Run typecheck and commit**

```bash
pnpm typecheck
git add apps/web/src/app/api/tools/\[id\]/executions/route.ts
git commit -m "feat: execution route resolves virtual ports for Modal ComfyUI"
```

---

## Task 5: Update all remaining localhost references

The spec undercounted localhost references. These additional files also hardcode `localhost`/`127.0.0.1` for ComfyUI and must use `resolveComfyBaseUrl`:

**Files to modify:**

| File | Localhost reference | Purpose |
|------|-------------------|---------|
| `apps/web/src/app/api/executions/[id]/route.ts` | `http://localhost:${comfyPort}/view?...` | Output download on PATCH completion |
| `apps/web/src/app/api/workflow/analyze/route.ts` | `http://localhost:${comfyPort}/object_info` | Build Tool wizard node analysis |
| `apps/web/src/app/api/comfy/[port]/logs-stream/route.ts` | `ws://127.0.0.1:${port}/ws`, `http://127.0.0.1:${port}/internal/logs/subscribe` | Second WS bridge for log streaming |
| `apps/web/src/app/api/comfy/[port]/custom-nodes/route.ts` | `http://127.0.0.1:${port}/models/custom_nodes` | Custom node info |
| `apps/web/src/app/api/bridge/tools/run/route.ts` | `http://127.0.0.1:${comfyPort}` | App bridge tool execution |
| `apps/web/src/lib/registry/executor.ts` | `http://127.0.0.1:${comfyPort}` | Registry-based tool execution |

**Not updated (intentionally):**
- `apps/web/src/lib/comfy-probe.ts` — scans localhost ports to find running ComfyUI processes. Only relevant for local instances.
- `apps/web/src/lib/modelScanner.ts` — scans models from local ComfyUI. Not used for cloud instances.

- [ ] **Step 1: Add import to each file**

In each file above, add:
```ts
import { resolveComfyBaseUrl } from '@/lib/modal-comfyui'
```

- [ ] **Step 2: Replace all localhost references**

For each file, replace `http://localhost:${port}` or `http://127.0.0.1:${port}` with `resolveComfyBaseUrl(port)`.

For WS references in `logs-stream/route.ts`, use the same pattern as Task 3 (extract host, use `wss://` for Modal). Skip `/internal/logs/subscribe` for Modal ports.

- [ ] **Step 3: Run typecheck and commit**

```bash
pnpm typecheck
git add apps/web/src/app/api/executions/ apps/web/src/app/api/workflow/ apps/web/src/app/api/comfy/ apps/web/src/app/api/bridge/ apps/web/src/lib/registry/
git commit -m "feat: update all remaining localhost refs to use resolveComfyBaseUrl"
```

---

## Task 6: Add `deploy-comfyui` and `scan-comfyui` commands to helper (renumbered)

**Files:**
- Modify: `apps/web/scripts/modal-helper.py`

- [ ] **Step 1: Add `scan-comfyui` command**

```python
def cmd_scan_comfyui(comfyui_path: str):
    """Scan local ComfyUI installation for custom nodes and models."""
    import glob

    # Get ComfyUI version
    version = ""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5, cwd=comfyui_path,
        )
        version = result.stdout.strip()
    except Exception:
        pass

    # Scan custom nodes
    custom_nodes = []
    cn_dir = os.path.join(comfyui_path, "custom_nodes")
    if os.path.isdir(cn_dir):
        for name in os.listdir(cn_dir):
            node_path = os.path.join(cn_dir, name)
            if not os.path.isdir(node_path) or name.startswith("."):
                continue
            git_dir = os.path.join(node_path, ".git")
            if not os.path.exists(git_dir):
                continue
            try:
                repo = subprocess.run(
                    ["git", "remote", "get-url", "origin"],
                    capture_output=True, text=True, timeout=5, cwd=node_path,
                ).stdout.strip()
                commit = subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    capture_output=True, text=True, timeout=5, cwd=node_path,
                ).stdout.strip()
                custom_nodes.append({"name": name, "repo": repo, "commit": commit})
            except Exception:
                pass

    # Scan models (just filenames and sizes, not content)
    models = []
    models_dir = os.path.join(comfyui_path, "models")
    if os.path.isdir(models_dir):
        for root, dirs, files in os.walk(models_dir):
            for f in files:
                if f.endswith((".safetensors", ".ckpt", ".pt", ".pth", ".bin")):
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, models_dir)
                    size = os.path.getsize(full)
                    models.append({"path": rel, "size": size})

    _json_out({
        "comfyuiPath": comfyui_path,
        "version": version,
        "customNodes": custom_nodes,
        "models": models,
    })
```

- [ ] **Step 2: Add `deploy-comfyui` command**

This generates a `comfyui_modal_app.py` from a template and deploys it:

```python
def cmd_deploy_comfyui(config_json: str, gpu: str, app_name: str):
    """Deploy a ComfyUI instance to Modal."""
    import json as json_mod
    import tempfile

    config = json_mod.loads(config_json)
    custom_nodes = config.get("customNodes", [])

    # Generate modal app file
    template = _generate_comfyui_modal_app(custom_nodes, gpu, app_name)

    # Write to temp dir
    app_dir = os.path.expanduser(f"~/.flowscale/aios/modal-comfyui-apps/{app_name}")
    os.makedirs(app_dir, exist_ok=True)
    app_file = os.path.join(app_dir, "comfyui_modal_app.py")
    with open(app_file, "w") as f:
        f.write(template)

    # Deploy
    env = {**os.environ, "FLOWSCALE_GPU": gpu, "FLOWSCALE_APP_NAME": app_name}
    # ... same deploy flow as cmd_deploy ...
```

The `_generate_comfyui_modal_app` function creates a Python file that:
- Builds a Modal image with ComfyUI + custom nodes (pinned to commit hashes)
- Starts ComfyUI as a subprocess on port 8188
- Reverse-proxies all HTTP + WebSocket via ASGI
- Mounts a Volume at `/models` for model storage

- [ ] **Step 3: Add dispatch entries**

```python
elif command == "scan-comfyui" and len(sys.argv) >= 3:
    cmd_scan_comfyui(sys.argv[2])
elif command == "deploy-comfyui" and len(sys.argv) >= 5:
    cmd_deploy_comfyui(sys.argv[2], sys.argv[3], sys.argv[4])
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/modal-helper.py
git commit -m "feat: add scan-comfyui and deploy-comfyui helper commands"
```

---

## Task 6: Create API routes for Modal ComfyUI

**Files:**
- Create: `apps/web/src/app/api/modal/comfyui/route.ts`
- Create: `apps/web/src/app/api/modal/comfyui/scan/route.ts`

- [ ] **Step 1: Create the scan route**

`GET /api/modal/comfyui/scan` — scans local ComfyUI installation:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { spawn } from 'child_process'
import { join } from 'path'
import { getSettings } from '@/lib/providerSettings'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = getSettings()
  const comfyuiPath = settings.comfyuiPath
  if (!comfyuiPath) return NextResponse.json({ error: 'ComfyUI path not configured' }, { status: 400 })

  // Call modal-helper.py scan-comfyui
  const result = await runHelper(['scan-comfyui', comfyuiPath])
  return NextResponse.json(result)
}
```

- [ ] **Step 2: Create the deploy/undeploy/list route**

`GET /api/modal/comfyui` — returns list of instances
`POST /api/modal/comfyui` — deploy/undeploy actions

Same pattern as the API-engine deploy route: name validation, deploy with fire-and-forget, undeploy.

- [ ] **Step 3: Run typecheck and commit**

```bash
pnpm typecheck
git add apps/web/src/app/api/modal/comfyui/
git commit -m "feat: API routes for Modal ComfyUI deploy/undeploy/scan"
```

---

## Task 7: Create Settings UI — Cloud Instances section

**Files:**
- Create: `apps/web/src/components/ModalComfySection.tsx`
- Create: `apps/web/src/hooks/useModalComfyInstances.ts`
- Modify: `apps/web/src/app/(main)/settings/page.tsx`

- [ ] **Step 1: Create the hook**

```ts
// useModalComfyInstances.ts
'use client'
import { useQuery } from '@tanstack/react-query'

export function useModalComfyInstances() {
  return useQuery({
    queryKey: ['modal-comfyui-instances'],
    queryFn: async () => {
      const res = await fetch('/api/modal/comfyui')
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
    refetchInterval: (query) => {
      const instances = query.state.data?.instances ?? []
      return instances.some((i: any) => i.status === 'deploying') ? 5_000 : 60_000
    },
  })
}
```

- [ ] **Step 2: Create `ModalComfySection` component**

Same pattern as `ModalDeployBanner` — deployment list with deploy popup (name + GPU), undeploy with confirmation. Shows custom nodes and models that will be included.

- [ ] **Step 3: Add to Settings > ComfyUI tab**

In `settings/page.tsx`, find the ComfyUI tab content and add:
```tsx
{modalStatus?.authenticated && <ModalComfySection />}
```

- [ ] **Step 4: Run typecheck and commit**

```bash
pnpm typecheck
git add apps/web/src/components/ModalComfySection.tsx apps/web/src/hooks/useModalComfyInstances.ts apps/web/src/app/\(main\)/settings/page.tsx
git commit -m "feat: Cloud Instances UI in Settings > ComfyUI tab"
```

---

## Task 8: Update tool page — provider/target for ComfyUI tools

**Files:**
- Modify: `apps/web/src/app/(main)/apps/[id]/page.tsx`

- [ ] **Step 1: Replace ComputePicker with provider/target for ComfyUI tools**

Currently ComfyUI tools use `<ComputePicker>` (lines ~1089-1098). Replace with the same two-dropdown pattern used by API tools:

```tsx
{!isArtist && tool.engine === 'comfyui' && (
  <>
    <select value={selectedProvider} onChange={...}>
      <option value="local">Local</option>
      {modalComfyInstances.length > 0 && <option value="modal">Modal</option>}
    </select>
    <select value={selectedTarget} onChange={...}>
      <option value="">Auto</option>
      {selectedProvider === 'local' && comfyInstances.map(i => (
        <option key={i.id} value={String(i.port)} disabled={i.status !== 'running'}>
          {i.label}
        </option>
      ))}
      {selectedProvider === 'modal' && modalComfyInstances
        .filter(i => i.status === 'deployed')
        .map(i => (
          <option key={i.id} value={String(i.virtualPort)}>
            {i.name} ({i.gpu})
          </option>
        ))
      }
    </select>
  </>
)}
```

- [ ] **Step 2: Fetch Modal ComfyUI instances**

Add a query to fetch the instances:
```ts
const { data: modalComfyData } = useModalComfyInstances()
const modalComfyInstances = modalComfyData?.instances ?? []
```

- [ ] **Step 3: Update port resolution**

When Modal provider + specific target: use the virtual port directly.
When Modal provider + Auto: use `autoRouteModalComfy()` on the server side (pass a flag).

```ts
// In the run mutation body:
const resolvedPort = selectedProvider === 'modal'
  ? (selectedTarget || modalComfyInstances[0]?.virtualPort)
  : effectiveComfyPort

body: JSON.stringify({
  inputs,
  comfyPort: resolvedPort,
  ...
})
```

- [ ] **Step 4: Run typecheck and commit**

```bash
pnpm typecheck
git add apps/web/src/app/\(main\)/apps/\[id\]/page.tsx
git commit -m "feat: provider/target dropdowns for ComfyUI tools with Modal support"
```

---

## Task 9: Create the ComfyUI Modal app template

**Files:**
- Create: template generation in `apps/web/scripts/modal-helper.py` (the `_generate_comfyui_modal_app` function)

- [ ] **Step 1: Write the template generator**

The function generates a complete `comfyui_modal_app.py` that:
1. Builds a Modal image: `debian_slim` → apt deps → pip install ComfyUI → clone custom nodes at pinned commits
2. Creates a Volume for models
3. On container start (`@modal.enter`): starts ComfyUI subprocess, waits for ready
4. ASGI reverse proxy: forwards all HTTP + WebSocket to internal ComfyUI
5. `extra_model_paths.yaml` baked in for Volume model paths

Key template sections:
- Image build with custom nodes
- ComfyUI subprocess management
- ASGI reverse proxy (httpx for HTTP, websockets for WS)
- Health check endpoint

- [ ] **Step 2: Test template generation**

```bash
python3 apps/web/scripts/modal-helper.py scan-comfyui /path/to/ComfyUI
# Then use the output to generate a template
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/modal-helper.py
git commit -m "feat: ComfyUI Modal app template generator with ASGI reverse proxy"
```

---

## Task 10: End-to-end verification

- [ ] **Step 1: Verify Settings > ComfyUI shows Cloud Instances section**
- [ ] **Step 2: Scan local ComfyUI and verify custom nodes/models detected**
- [ ] **Step 3: Deploy a Modal ComfyUI instance**
- [ ] **Step 4: Verify virtual port assigned and instance appears in list**
- [ ] **Step 5: Navigate to a ComfyUI tool, verify Provider/Target dropdowns**
- [ ] **Step 6: Select Modal provider, verify Modal instances in target dropdown**
- [ ] **Step 7: Run a ComfyUI workflow on Modal**
- [ ] **Step 8: Verify WebSocket progress works (step-by-step updates)**
- [ ] **Step 9: Verify output images download and display**
- [ ] **Step 10: Undeploy the instance**
- [ ] **Step 11: Run typecheck**
- [ ] **Step 12: Verify local ComfyUI tools still work unchanged**
