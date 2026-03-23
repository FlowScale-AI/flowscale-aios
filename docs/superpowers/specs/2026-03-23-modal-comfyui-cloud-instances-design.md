# Modal ComfyUI Cloud Instances

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Deploy ComfyUI on Modal as shared infrastructure, accessible from all ComfyUI-engine tools via virtual port mapping.

---

## Overview

ComfyUI runs on Modal as shared cloud infrastructure — one or more Modal instances serve all ComfyUI-engine tools, just like local ComfyUI instances do. Deployed and managed from Settings > ComfyUI tab. Mirrors the user's local ComfyUI setup (custom nodes + models). Uses virtual ports (50000+) so the existing `/api/comfy/[port]/[...path]` proxy route works unchanged — no modifications needed to the tool page, execution route, or ComfyUI client.

## 1. Settings > ComfyUI Tab — Cloud Instances Section

A new "Cloud Instances" section added to the bottom of the ComfyUI settings tab. Only shown when Modal is connected (`modalStatus.authenticated`).

```
┌─ Cloud Instances (Modal) ──────────────────────────┐
│                                                     │
│  comfyui-a10g-1   A10G  ● Deployed    [Undeploy]   │
│  comfyui-h100-1   H100  ○ Deployed    [Undeploy]   │
│                                                     │
│                               [+ Deploy Instance]   │
└─────────────────────────────────────────────────────┘
```

**Deploy popup** — same pattern as API-engine tools:
- Name input (auto: `comfyui-{gpu lowercase}-{n}`)
- GPU picker (T4 / A10G / L4 / A100 / H100)
- Deploy button

**Deploy process:**
1. Scans local ComfyUI installation for custom nodes and models
2. Builds Modal image with ComfyUI + custom nodes
3. Downloads models to a Volume on first cold start
4. Registers the instance with a virtual port

**Undeploy** — stops and deletes the Modal app, removes the virtual port mapping.

## 2. Virtual Port Mapping

Modal ComfyUI instances are assigned virtual ports starting at 50000. This allows the existing proxy route to work without changes — it just needs to resolve virtual ports to Modal URLs instead of localhost.

**Port assignment:** Sequential from 50001. When an instance is undeployed, its port is freed for reuse.

**State file:** `~/.flowscale/aios/modal-comfyui.json`

```json
[
  {
    "id": "comfyui-a10g-1",
    "name": "comfyui-a10g-1",
    "status": "deploying" | "deployed",
    "gpu": "A10G",
    "virtualPort": 50001,
    "appName": "flowscale-comfyui-a10g-1",
    "url": "https://rupayanism--flowscale-comfyui-a10g-1-serve.modal.run",
    "deployedAt": 1742737000000
  }
]
```

**TypeScript types:**
```ts
interface ModalComfyInstance {
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
```

### Virtual port resolution

```ts
const MODAL_COMFY_PORT_BASE = 50000

function getModalComfyUrl(port: number): string | null {
  const instances = readModalComfyInstances()
  const instance = instances.find(i => i.virtualPort === port && i.status === 'deployed')
  return instance?.url ?? null
}

function isModalComfyPort(port: number): boolean {
  return port > MODAL_COMFY_PORT_BASE && port < MODAL_COMFY_PORT_BASE + 1000
}
```

**Port assignment algorithm:** Find the max `virtualPort` across all instances and add 1. Starts at 50001. Ports within range 50001-50999.

## 3. Central URL Resolver (CRITICAL)

**The proxy route is NOT the only place that references `localhost:${port}`.** The execution route, output downloader, and WebSocket SSE bridge all make direct `http://127.0.0.1:${port}` calls that bypass the proxy. All of these must be updated.

**Solution:** A central `resolveComfyBaseUrl(port)` function used everywhere:

```ts
// In modal-comfyui.ts
export function resolveComfyBaseUrl(port: number): string {
  if (isModalComfyPort(port)) {
    const url = getModalComfyUrl(port)
    if (!url) throw new Error(`Modal ComfyUI instance for port ${port} not found`)
    return url
  }
  return `http://127.0.0.1:${port}`
}
```

### Files that call `localhost:${port}` directly (all must use `resolveComfyBaseUrl`):

1. **Proxy route** (`apps/web/src/app/api/comfy/[port]/[...path]/route.ts`) — the HTTP proxy
2. **Execution route** (`apps/web/src/app/api/tools/[id]/executions/route.ts`):
   - Line ~305: `fetch(\`http://localhost:${comfyPort}/object_info\`)` — get node definitions
   - Line ~358: `fetch(\`http://localhost:${comfyPort}/prompt\`)` — queue prompt
   - Line ~403: `getHistory(promptId, baseUrl)` where `baseUrl = \`http://localhost:${comfyPort}\``
3. **Output download** (`saveComfyOutputsToDisk`):
   - Line ~34: `fetch(\`http://localhost:${comfyPort}/view?...\`)` — download output images
4. **WebSocket SSE bridge** (`apps/web/src/app/api/comfy/[port]/ws/route.ts`):
   - `new WebSocket(\`ws://127.0.0.1:${port}/ws\`)` — direct WS connection
5. **Port validation** in execution route:
   - Line ~276: validates port against `getComfyInstances()` — must also allow virtual ports

### Execution route port validation fix

```ts
// Current (rejects virtual ports):
const validPorts = new Set(getComfyInstances().map((i) => i.port))
if (!validPorts.has(comfyPortOverride)) { ... }

// Updated:
const validPorts = new Set(getComfyInstances().map((i) => i.port))
const isValidModalPort = isModalComfyPort(comfyPortOverride) && getModalComfyUrl(comfyPortOverride) != null
if (!validPorts.has(comfyPortOverride) && !isValidModalPort) { ... }
```

### WebSocket support for Modal

Modal's ASGI infrastructure supports WebSocket connections. The ComfyUI subprocess inside the container has full WS support. The ASGI reverse proxy forwards both HTTP and WebSocket to the internal ComfyUI process.

**Implementation:** The `/api/comfy/[port]/ws` bridge uses `resolveComfyBaseUrl` to get the Modal URL, then connects to `wss://{modal-url}/ws` instead of `ws://127.0.0.1:${port}/ws` for virtual ports:

```ts
const isModal = isModalComfyPort(port)
const wsUrl = isModal
  ? `wss://${new URL(resolveComfyBaseUrl(port)).host}/ws?clientId=${clientId}`
  : `ws://127.0.0.1:${port}/ws?clientId=${clientId}`
```

This gives full real-time progress: step-by-step denoising updates, node execution status, and live previews — same as local ComfyUI.

**Lifecycle:** WebSocket connects only during execution (user clicks Run) and disconnects when the prompt completes. The container stays alive during execution, then scales down after `scaledown_window` (60s). No persistent WS connections keeping containers warm.

**Log streaming:** The HTTP PATCH to `/internal/logs/subscribe` (line 16 of ws/route.ts) is skipped for Modal ports — it's a ComfyUI Manager-specific endpoint that may not be available on cloud instances.

### Proxy timeout for cold starts

Modal containers can take 30-120+ seconds on cold start. The proxy route should use a longer timeout for virtual ports:

```ts
const timeout = isModalComfyPort(port) ? 180_000 : 30_000
```

## 4. ComputePicker / Provider-Target Dropdown

ComfyUI tools switch from the current `ComputePicker` component to the same two-dropdown provider/target pattern used by API-engine tools:

**Provider dropdown:** `Local` | `Modal`
- `Modal` only shown when Modal is connected AND at least one Modal ComfyUI instance is deployed

**Target dropdown (when Provider = Local):**
- Auto, GPU 0 — RX 7700 XT, GPU 1 — Raphael, CPU
- (existing ComfyUI instances from `comfyManageData`)

**Target dropdown (when Provider = Modal):**
- Auto, comfyui-a10g-1 (A10G), comfyui-h100-1 (H100)
- (Modal ComfyUI instances from `modal-comfyui.json`)

**Port resolution:**
- Local target → real port (8188, 8189, etc.)
- Modal target → virtual port (50001, 50002, etc.)
- Auto (Local) → round-robin across running local instances
- Auto (Modal) → round-robin across deployed Modal instances

The resolved port is passed as `comfyPort` in the execution request — the proxy handles the rest.

## 5. Modal App Template

A template that runs ComfyUI as a subprocess inside a Modal container, exposed via ASGI reverse proxy.

### Image build

```python
_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libgl1")
    .pip_install("torch", "torchvision", "torchaudio")
    .run_commands(
        "git clone https://github.com/comfyanonymous/ComfyUI /comfyui",
        "cd /comfyui && pip install -r requirements.txt",
    )
    # Install custom nodes (detected from local installation at deploy time)
    .run_commands(*[
        f"cd /comfyui/custom_nodes && git clone {repo}"
        for repo in custom_node_repos
    ])
)
```

The list of custom node git repos **and commit hashes** is captured at deploy time by scanning `ComfyUI/custom_nodes/`. Each node is cloned at the exact commit hash to match the user's local installation:

```python
.run_commands(*[
    f"cd /comfyui/custom_nodes && git clone {repo} && cd {name} && git checkout {commit}"
    for repo, name, commit in custom_nodes
])
```

### Model storage

Models are stored on a Modal Volume (`flowscale-comfyui-models`), mounted at `/models`.

**V1 approach for models:** Users must ensure their models are available on HuggingFace. The scan captures model filenames, but the user provides HuggingFace model IDs via the deploy popup for any models that need cloud access. Models already cached in the ComfyUI Manager's download registry have known URLs.

**Alternative for V1:** Skip model syncing entirely. The user manually downloads models to the Volume via a `modal volume put` command, or the first workflow execution fails with "model not found" and the user adds it. This is documented as a known limitation.

### `extra_model_paths.yaml` generation

Generated at deploy time and baked into the image:

```yaml
flowscale_modal:
  base_path: /models
  checkpoints: checkpoints/
  loras: loras/
  vae: vae/
  controlnet: controlnet/
  upscale_models: upscale_models/
```

The Volume directory structure mirrors the standard ComfyUI `models/` layout.

### ComfyUI subprocess

```python
@app.cls(gpu=_gpu, volumes={"/models": _vol})
class ComfyUIServer:
    @modal.enter()
    def start(self):
        import subprocess
        # Configure model paths
        # Start ComfyUI on internal port 8188
        self.proc = subprocess.Popen(
            ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188",
             "--preview-method", "none", "--extra-model-paths-config", "/models/extra_model_paths.yaml"],
            cwd="/comfyui"
        )
        # Wait for ComfyUI to be ready
        _wait_for_ready("http://localhost:8188")

    @modal.asgi_app()
    def serve(self):
        # Reverse proxy all HTTP requests to localhost:8188
        from starlette.applications import Starlette
        from starlette.routing import Route, Mount
        from starlette.responses import StreamingResponse
        import httpx
        # ... reverse proxy implementation
```

### Deploy helper integration

Reuse the existing `modal-helper.py` infrastructure:
- `modal-helper.py deploy-comfyui <config-json> <gpu> <app-name>`
- Config JSON contains: custom node repos, model list, ComfyUI version
- Helper runs `modal deploy comfyui_modal_app.py` with the config

## 6. Deploy Flow (detailed)

1. User clicks "+ Deploy Instance" in Settings > ComfyUI > Cloud Instances
2. Popup: name (auto: `comfyui-a10g-1`), GPU selector, deploy button
3. Backend scans local ComfyUI installation:
   - `custom_nodes/` → list git remote URLs (`git -C {dir} remote get-url origin`)
   - `models/` → list model files (relative paths, sizes)
   - ComfyUI version (`git -C {comfyui_path} rev-parse HEAD`)
4. Generates config JSON with the scan results
5. Generates `comfyui_modal_app.py` from template + config
6. Saves to `~/.flowscale/aios/modal-comfyui-apps/{name}/`
7. Runs `modal deploy` via the helper
8. On success: assigns virtual port, writes to `modal-comfyui.json`
9. Instance appears in Settings and ComputePicker

## 7. API Routes

### `GET /api/modal/comfyui`
Returns list of Modal ComfyUI instances with status.

### `POST /api/modal/comfyui`
Actions:
- `{ action: "deploy", gpu: "A10G", name: "comfyui-a10g-1" }` — deploy new instance
- `{ action: "undeploy", instanceId: "comfyui-a10g-1" }` — stop and delete

### `GET /api/modal/comfyui/scan`
Scans local ComfyUI installation and returns:
```json
{
  "comfyuiPath": "/path/to/ComfyUI",
  "version": "abc123",
  "customNodes": [
    { "name": "ComfyUI-Impact-Pack", "repo": "https://github.com/...", "commit": "def456" }
  ],
  "models": [
    { "path": "checkpoints/v1-5-pruned.safetensors", "size": 4265380864 }
  ]
}
```

## 8. File Changes

### New files
| File | Purpose |
|------|---------|
| `apps/web/src/lib/modal-comfyui.ts` | Modal ComfyUI instance manager, virtual port mapping |
| `apps/web/src/app/api/modal/comfyui/route.ts` | Deploy/undeploy/list API |
| `apps/web/src/app/api/modal/comfyui/scan/route.ts` | Scan local ComfyUI installation |
| `apps/web/src/hooks/useModalComfyInstances.ts` | Hook to fetch Modal ComfyUI instances |
| `apps/web/src/components/ModalComfySection.tsx` | Cloud Instances UI in Settings > ComfyUI |
| `~/.flowscale/aios/modal-comfyui-apps/` (template dir) | Generated Modal app files per instance |

### Modified files
| File | Change |
|------|--------|
| `apps/web/src/app/api/comfy/[port]/[...path]/route.ts` | Use `resolveComfyBaseUrl`, increase timeout for Modal ports |
| `apps/web/src/app/api/comfy/[port]/ws/route.ts` | Use `resolveComfyBaseUrl` for WS URL, skip log subscription for Modal |
| `apps/web/src/app/api/tools/[id]/executions/route.ts` | Use `resolveComfyBaseUrl` for object_info, prompt, history, outputs. Allow virtual ports in validation. |
| `apps/web/src/app/(main)/settings/page.tsx` | Add Cloud Instances section to ComfyUI tab |
| `apps/web/src/app/(main)/apps/[id]/page.tsx` | Use provider/target dropdowns for ComfyUI tools. Skip SSE for Modal ports. Show indeterminate spinner. |
| `apps/web/src/components/ComputePicker.tsx` | Keep for canvas/test playground (local only). Tool page switches to provider/target. |
| `apps/web/scripts/modal-helper.py` | Add `deploy-comfyui` command |

## 9. Migration / Compatibility

- Existing local ComfyUI instances continue to work unchanged
- The `ComputePicker` component is kept for backward compatibility but ComfyUI tools on the tool page switch to provider/target dropdowns
- Canvas `ExecutionMenu` and `ToolTestPlayground` continue using `ComputePicker` (local only for now — cloud support on canvas is future work)
- Virtual ports are invisible to the user — they see instance names in the dropdown

## 10. Limitations (V1)

- **Model download on first cold start** — can take several minutes for large models
- **Custom node compatibility** — some custom nodes with C++ extensions may not build on Modal's Debian image
- **No model upload from local** — models must be downloadable from HuggingFace/Civitai (can't upload local-only models)
- **Cold start latency** — first request after scaledown takes 30-120s (container boot + ComfyUI startup + model loading)
