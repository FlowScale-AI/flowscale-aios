# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment requirements

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (pinned to 9.15.0 in root `package.json`)

## Commands

```bash
# Install dependencies
pnpm install

# Start web app (Next.js, port 14173)
pnpm --filter @flowscale/aios-web dev

# Typecheck all workspaces
pnpm typecheck

# Run tests (vitest)
pnpm --filter @flowscale/aios-web test
pnpm --filter @flowscale/workflow test

# Run a single test file
pnpm --filter @flowscale/aios-web test -- src/lib/someFile.test.ts
pnpm --filter @flowscale/workflow test -- src/someFile.test.ts

# Run tests with coverage
pnpm test:coverage

# E2E tests (Cypress — requires web running on port 14173)
# Set CYPRESS_ADMIN_PASSWORD env var first
pnpm --filter @flowscale/aios-web e2e

# Build all workspaces (turbo, respects dependency order)
pnpm build

# Build a single package
pnpm --filter @flowscale/workflow build
pnpm --filter @flowscale/aios-web build

# Start Electron desktop (must build first, and web must be running on 14173)
pnpm --filter @flowscale/aios-desktop build
apps/desktop/node_modules/.bin/electron apps/desktop/dist/main.js

# Release builds (electron-builder)
pnpm release:mac      # macOS DMG
pnpm release:linux    # Linux AppImage
pnpm release:win      # Windows NSIS installer
```

Typecheck is the primary correctness tool — always run after changes. `packages/workflow` also has vitest tests.

> **Next.js route exports:** Route files (`route.ts`) can only export HTTP method handlers (`GET`, `POST`, etc.). Never export helper functions from route files — move shared utilities to a separate module (e.g. `utils.ts` in the same directory). Next.js will fail the build otherwise.

## Branching strategy

- Create feature branches from `dev`: `git checkout -b feat/my-feature dev`
- PRs should target `dev`, not `main`. PRs targeting `main` directly will not be merged without prior discussion.

## Code style

- TypeScript strict mode is enabled — avoid `any`.
- Use named exports; avoid default exports for components.
- Import UI primitives from `@flowscale/ui` (the barrel at `apps/web/src/components/ui/index.ts`), not from shadcn paths directly.
- Tailwind for styling; avoid inline `style` props.
- Keep API routes thin — move logic into `lib/` utilities.

## Repo Structure

Turborepo + pnpm workspaces:

- **`apps/web`** (`@flowscale/aios-web`) — Next.js 15 App Router, the entire UI and API surface
- **`apps/desktop`** (`@flowscale/aios-desktop`) — Electron 39 shell that loads `apps/web` on port 14173
- **`packages/workflow`** (`@flowscale/workflow`) — zero-dependency library for ComfyUI workflow analysis; used by `apps/web`
- **`packages/sdk`** (`@flowscale/sdk`) — SDK for app developers building on top of tools
- **`packages/create-app`** — CLI scaffolding tool (`create-flowscale-aios-app`)
- **`example-apps/`** — sample app bundles for reference

## Architecture

### Data flow

All ComfyUI communication goes through Next.js API routes (CORS-free):
- `GET /api/comfy/scan` — probes configured instance ports to find running ComfyUI instances
- `GET|POST /api/comfy/[port]/[...path]` — transparent proxy to `http://127.0.0.1:[port]/[path]`; uses `url.pathname` (not decoded route params) to preserve `%2F` encoding needed for ComfyUI's `/userdata` routes

Persistence is local SQLite at `~/.flowscale/aios.db` via Drizzle ORM + better-sqlite3. Schema is in `apps/web/src/lib/db/schema.ts`; the DB is initialised in `apps/web/src/lib/db/index.ts`.

Settings and secrets are stored in flat JSON files (not the DB):
- `~/.flowscale/aios/settings.json` — ComfyUI path, install type, managed port, multi-instance configs, Comfy.org API key
- `~/.flowscale/aios/provider-keys.json` — API keys for cloud providers (fal, replicate, openrouter, huggingface)
- `~/.flowscale/aios/comfyui-{instanceId}.pid` — PID files for managed ComfyUI processes

Both are managed by `apps/web/src/lib/providerSettings.ts`.

> **Test DDL**: Integration tests use an in-memory SQLite DB built from a hand-written DDL in `apps/web/src/__tests__/integration/setup.ts`. When adding or renaming columns in `schema.ts`, also update that DDL or tests will fail with `SqliteError: no such column`.

### Database schema

Eleven tables (see `apps/web/src/lib/db/schema.ts` for Drizzle types):
- **`tools`** — saved tool definitions; `schemaJson` stores `WorkflowIO[]`; `layout` is `'left-right' | 'canvas'`; `status` is `'dev' | 'production'`; `engine` is `'comfyui' | 'api'`; `source` is `'comfyui' | 'registry' | 'custom'`. For API-engine tools, `workflowJson` stores `{ engine, model, pluginId }` instead of a workflow graph.
- **`executions`** — run history per tool; cascades on tool delete; `status` is `'running' | 'completed' | 'error'`
- **`canvases`** — visual boards; viewport + settings stored as JSON strings; `isShared` bool
- **`canvas_items`** — draggable objects on a canvas; composite PK `(canvas_id, id)`; has `type`, `position`, `zIndex`, `locked`, `hidden`, `data`
- **`tool_configs`** — input/output visibility config keyed by `workflow_id`
- **`users`** — auth; `role` is `'admin' | 'pipeline_td' | 'dev' | 'artist'`; `status` is `'active' | 'pending' | 'disabled'`
- **`sessions`** — session tokens; FK → users
- **`setup`** — one-time initial admin password (seeded on first run)
- **`installed_apps`** — optional metadata for installed apps; `source` is `'sideloaded' | 'registry' | 'github' | 'local'`; the filesystem (`~/.flowscale/apps/`) is the source of truth for what apps exist
- **`app_storage`** — per-app key-value storage; FK → installed_apps
- **`models`** — scanned local model files; `type` is `'checkpoint' | 'lora' | 'vae' | 'controlnet' | 'upscaler' | 'other'`

### Output storage

All tool execution outputs (both ComfyUI-engine and API-engine) are saved to `~/.flowscale/aios-outputs/[toolId]/[executionId_filename]` and served via `GET /api/outputs/[...path]`. The `outputsJson` column in `executions` stores items with a `path` field starting with `/api/outputs/...` — this is what the Assets page uses for display. Never trust a bare filename as a display URL; only `path` values starting with `/` are valid local paths.

When a ComfyUI-engine execution completes (`PATCH /api/executions/[id]` with `status: 'completed'`), `saveOutputsToDisk` downloads files from ComfyUI, writes them to disk, and re-writes `outputsJson` with updated `path` fields.

### App bundle system (filesystem-first)

Apps live in `~/.flowscale/apps/[id]/` — each directory must contain a `flowscale.app.json` manifest. **The filesystem is the source of truth**: `GET /api/apps` scans `~/.flowscale/apps/` and returns every directory with a valid manifest. No DB record is needed for an app to appear on the `/apps` page. The DB `installed_apps` table is optional metadata (source tracking, timestamps) and hosts `app_storage` FK references.

**Installation methods:**
- **GitHub URL** — `POST /api/apps/install-github` downloads a repo tarball, builds if `package.json` has a build script, copies bundle to `~/.flowscale/apps/[name]/`
- **Local folder** — `POST /api/apps/install-local` validates, builds if needed, copies to `~/.flowscale/apps/[name]/`
- **Manual** — drop a folder with `flowscale.app.json` + built assets into `~/.flowscale/apps/`

### App bridge protocol

Apps run in sandboxed iframes (`sandbox="allow-scripts allow-same-origin"`). They communicate with the host exclusively via **JSON-RPC 2.0 over `postMessage`** — apps must never call ComfyUI directly via `fetch` or `WebSocket`.

```js
// Inside an app bundle — minimal bridge client
const Bridge = (() => {
  let _id = 1
  const _pending = new Map()
  window.addEventListener('message', (e) => {
    const msg = e.data
    if (!msg || msg.jsonrpc !== '2.0' || msg.id == null) return
    const cb = _pending.get(msg.id)
    if (cb) { _pending.delete(msg.id); cb(msg) }
  })
  return {
    call(method, params) {
      return new Promise((resolve) => {
        const id = _id++
        _pending.set(id, resolve)
        window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
      })
    }
  }
})()
```

Key bridge methods (handled by `apps/web/src/lib/bridge/server.ts`):
- `app.ready` — signal iframe is loaded
- `tools.list` / `tools.get` / `tools.run` — requires `tools` permission; `tools.run` accepts `{ id, inputs, comfyPort? }` and resolves when execution completes
- `providers.list` / `providers.run` — requires `providers:[name]` permission
- `storage.get/set/delete/keys` — requires `storage:readwrite`
- `storage.files.read/write/delete/list` — requires `storage:files`
- `ui.toast` / `ui.confirm`

For `tools.run`, registry tool inputs use `"${nodeId}.${paramName}"` keys (e.g. `"6.text"` for a CLIPTextEncode node). Image inputs can be passed as base64 data URLs (`data:image/png;base64,...`) — the server uploads them to ComfyUI's input dir before queuing.

The `url` field in registry tool outputs is an absolute `http://127.0.0.1:PORT/view?...` URL. Convert to proxy before setting `img.src`: replace with `/api/comfy/PORT/path`.

### Tool plugin system (API-engine tools)

Tools have two engines: `comfyui` (workflow-based, default) and `api` (plugin-driven, local inference).

API-engine tools are backed by plugins in `~/.flowscale/tool-plugins/{id}/`, each containing a `manifest.json` (schema, server config) and `server.py` (HuggingFace model inference server). Plugin logic lives in `apps/web/src/lib/toolPlugins.ts`.

- **Registry plugins** — fetched from `FLOWSCALE_REGISTRY_URL` (default `https://flowscale.ai/tools/registry.json`), cached locally in `~/.flowscale/aios/registry-cache.json` (5-min TTL). Installed via `POST /api/tool-plugins/install/{id}`.
- **Custom plugins** — placed directly in `~/.flowscale/tool-plugins/`, auto-registered into the `tools` DB on startup.
- When executing API-engine tools, `POST /api/tools/[id]/executions` checks that the plugin's `server.py` is running on its configured port, then forwards inputs to it.

### ComfyUI multi-instance management

`apps/web/src/lib/comfyui-manager.ts` manages N+1 ComfyUI processes (one per GPU + one CPU-only). Each instance has a stable ID (`gpu-0`, `gpu-1`, `cpu`).

- **Port range:** AIOS-managed instances use base port `41188` (defined as `AIOS_COMFY_BASE_PORT` in `providerSettings.ts`) to avoid collisions with externally launched ComfyUI on default 8188.
- **State persistence:** PID files at `~/.flowscale/aios/comfyui-{id}.pid` survive Next.js hot-reloads. In-memory `comfyProcesses` map is secondary.
- **Device isolation:** `CUDA_VISIBLE_DEVICES` (NVIDIA) or `HIP_VISIBLE_DEVICES` (AMD ROCm) env vars pin each instance to a specific GPU. CPU instances use `--cpu` flag.
- **External detection:** Before starting, `findExternalComfyOnDevice()` scans `/proc/PID/environ` (Linux-only) for non-AIOS `python.*main.py --port` processes on the same device and blocks with an error. Processes on AIOS-configured ports are excluded from external detection.
- **API:** `GET /api/comfy/manage` returns instance statuses; `POST /api/comfy/manage` accepts `{ action: 'start'|'stop'|'restart', instanceId? }`.

### GPU detection

`apps/web/src/lib/gpu-detect.ts` detects GPUs via `nvidia-smi` (NVIDIA) or `rocm-smi` + `lspci` (AMD). Returns `GpuInfo[]` with index, name, VRAM, backend. Results are process-lifetime cached.

- `GET /api/gpu` — cached GPU + CPU info
- `POST /api/gpu` — re-detect (clears cache)
- `POST /api/comfy/instances/detect` — detects GPUs, generates instance configs (one per GPU + CPU), saves to settings

### Modal cloud GPU integration

Modal is a cloud GPU provider used for remote execution of both API-engine tool plugins and ComfyUI instances. Core modules:

- **`apps/web/src/lib/modal-manager.ts`** — Modal CLI installation, authentication, status checks
- **`apps/web/src/lib/modal-deploy.ts`** — Deploy/undeploy API-engine tool plugins to Modal; persistent state in `~/.flowscale/aios/modal-deployments.json`
- **`apps/web/src/lib/modal-comfyui.ts`** — Manages shared ComfyUI instances on Modal using virtual port mapping (ports 50000–50999)
- **`apps/web/scripts/modal-helper.py`** — Python bridge to Modal SDK, called by `modal-deploy.ts`

**API routes:**
- `POST /api/modal/setup` — install Modal CLI and authenticate
- `GET /api/modal/status` — Modal auth/install status
- `POST /api/modal/deploy/[pluginId]` — deploy/undeploy API-engine plugins
- `GET /api/modal/comfyui` — list deployed cloud ComfyUI instances
- `POST /api/modal/comfyui/scan` — scan for deployable instances

**GPU tiers:** `T4 | L4 | A10 | L40S | A100-40GB | A100-80GB | RTX-PRO-6000 | H100 | H200 | B200` (default: A10). Plugins can declare Modal support and a default GPU tier in their manifest via `ModalCloudConfig`.

### Compute picker (instance selection)

The `ComputePicker` component (`apps/web/src/components/ComputePicker.tsx`) is a unified UI for selecting execution targets: a specific local ComfyUI instance, "Auto" (round-robin across running instances), or "Modal" (cloud). Three surfaces use it:
- **Tool page** (`apps/[id]/page.tsx`) — dropdown in the toolbar
- **Build-tool test step** (`ToolTestPlayground.tsx`) — dropdown in the topbar
- **Canvas** (`ExecutionMenu.tsx`) — compact dropdown in the floating control bar

When "Auto" is selected (default with 2+ running instances), executions are distributed across running instances via **round-robin** (ref counter in a `useRef`). The resolved port is passed as `comfyPort` in the `POST /api/tools/[id]/executions` body.

### Local inference plugin management

`apps/web/src/lib/localInference.ts` manages local API-engine plugin processes via `child_process.spawn()`. Handles health checks, port allocation, lifecycle management, and stdio log capture.

### Workflow analysis (`packages/workflow`)

Two ComfyUI workflow formats exist: **API format** (`{ "1": { class_type, inputs } }`) and **graph format** (the `{ nodes, links }` format saved by the UI). Key exports:
- `isValidComfyWorkflow` — detects either format
- `normalizeWorkflow` — converts graph → API format; pass `objectInfoMap` (from ComfyUI `GET /object_info`) to resolve widget param names for custom nodes automatically
- `analyzeWorkflow` — walks API-format nodes, emits `WorkflowIO[]` for every non-output node's widget inputs and every output node
- `analyzeGraphSourceNodes` — detects custom "source" nodes (e.g. WAS Text Multiline) that have no linked inputs but feed primitive values; merged into the schema by the `/api/workflow/analyze` route

When ComfyUI is running and `comfyPort` is provided to `POST /api/workflow/analyze`, the system fetches `GET /object_info` and uses it to name widget params for all nodes automatically — no static table additions needed.

### Build Tool wizard (`apps/web/src/app/(main)/build-tool/page.tsx`)

Four-step flow: **Attach → Auto-Configure → Test → Deploy**. All four steps in a single file. Key behaviours:
- Step 1 (`StepAttach`): fetches `GET /api/comfy/[port]/userdata?dir=workflows` for the workflow grid; calls `onNext(json, name)` where `name` is the filename without `.json`
- Step 2 (`StepConfigure`): POSTs to `/api/workflow/analyze` then `/api/tools`; `initialName` prop seeds the tool name field
- Step 3 (`StepTest`): runs the saved tool against a live ComfyUI instance via WebSocket
- Step 4 (`StepDeploy`): POSTs to `/api/tools/[id]/deploy` to flip status to `production`

### Electron bridge

Desktop-only APIs are exposed via `window.desktop` (typed in `apps/web/src/types/desktop.d.ts`):
- `window.desktop.dialog.openFile()` / `openDirectory()` — native file picker, returns JSON string
- `window.desktop.shell.openExternal(url)` — open URL in system browser
- `window.desktop.watch.start(path, cb)` / `stop(path)` — file system watching
- `window.desktop.auth.*` — PKCE OAuth against `https://dev-api.flowscale.ai`

In browser mode `window.desktop` is `undefined`; feature-gate with `if (window.desktop)`.

In **production**, Electron spawns the Next.js standalone server from `process.resourcesPath/apps/web/.next/standalone/apps/web/server.js` and polls `http://127.0.0.1:PORT` until ready (60s timeout).

### Key utilities

- **`apps/web/src/lib/axios.ts`** — pre-configured Axios instance with base `/`; response interceptor auto-unwraps `.data`, so callers receive the payload directly
- **`apps/web/src/lib/comfyui-client.ts`** — typed REST + WebSocket client for ComfyUI (`queuePrompt`, `getHistory`, `connectWS`, etc.)
- **`apps/web/src/lib/platform.ts`** — `isDesktop()` check; `getComfyUIUrl()` / `setComfyUIUrl()` and `getComfyOrgApiKey()` / `setComfyOrgApiKey()` backed by localStorage
- **`apps/web/src/store/notificationStore.ts`** — minimal notification hook (console-only, no toast UI); pages that need error display use local state

### Path aliases (`apps/web`)

- `@/*` → `./src/*`
- `@flowscale/ui` → `./src/components/ui/index.ts`

### Log file paths (electron-log)

The Electron app writes logs via `electron-log`. The log file location per platform:

- **Linux:** `~/.config/flowscale-aios/logs/main.log`
- **macOS:** `~/Library/Logs/flowscale-aios/main.log`
- **Windows:** `%APPDATA%\flowscale-aios\logs\main.log`

These logs are automatically attached to issue reports submitted via the "Report Issue" button in the sidebar (read via `report:getSystemInfo` IPC, last 1000 lines).

### Reserved ports

- **14173** — `apps/web` Next.js dev server
- **41188–41200** — AIOS-managed ComfyUI instances (base port `41188`, one per GPU + CPU)
- **50000–50999** — Virtual ports for Modal cloud ComfyUI instances
- **5173** and **3001** — occupied by other services on the host; never use these

### `@flowscale/ui` barrel

`apps/web/src/components/ui/index.ts` re-exports `Tooltip`, `cn`, `Modal`, `useNotificationStore`. Import UI primitives from there rather than directly from shadcn paths.

### Design system

From `DESIGN.md` — cyber-tech aesthetic, dark-mode-first:

**Colors:**
- Backgrounds: `#09090b` (deepest), `#121214` (panels), `#18181b` / `#111113` (cards)
- Primary text: `#d4d4d8`; borders: `border-white/5`
- Accent: Emerald (`emerald-400/500/600`); neutrals: Zinc scale

**Typography:**
- Sans (Inter): general UI
- Tech (Space Grotesk): headings — use `.font-tech`
- Mono (JetBrains Mono): code/technical values — use `.font-mono`

**Conventions:**
- Tooltips required for icon-only buttons (`delay={600}`)
- Inputs: `border-zinc-800`, focus `border-emerald-500/50`
- Buttons: Primary (`bg-zinc-100 text-black`), Secondary (`bg-zinc-900`), Ghost (transparent)

### CI/CD

GitHub Actions (`.github/workflows/`):
- **`test.yml`** — runs on push to `main`/`dev` and all PRs: typecheck → vitest → coverage → Cypress E2E
- **`release.yml`** — triggered by `v*` tags or manual dispatch: builds web standalone, rebuilds `better-sqlite3` for Electron ABI, packages with electron-builder for macOS/Linux/Windows, creates GitHub Release draft

## Product concepts

- **Tools** — single-model/workflow endpoints. Two engines: **ComfyUI-engine** tools (built via the Build Tool wizard from ComfyUI workflows) and **API-engine** tools (backed by local inference plugins with HuggingFace models). Both stored in the `tools` table, run via `/api/tools/[id]/executions`.
- **Apps** — full-fledged HTML bundles that orchestrate tools via the bridge protocol. Apps live in `~/.flowscale/apps/[id]/` and are auto-detected from the filesystem. Install via GitHub URL, local folder, or manual drop. Per-app state in `app_storage`.
- **Models** — local model files scanned from ComfyUI paths; listed via `/api/models`.
