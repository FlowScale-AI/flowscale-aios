# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment requirements

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (pinned to 9.15.0 in root `package.json`)

## Commands

```bash
# Start web app (Next.js, port 14173)
pnpm --filter @flowscale/aios-web dev

# Typecheck all workspaces
pnpm typecheck

# Run tests (vitest)
pnpm --filter @flowscale/aios-web test
pnpm --filter @flowscale/workflow test

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

## Repo Structure

Turborepo + pnpm workspaces with five packages:

- **`apps/web`** (`@flowscale/aios-web`) — Next.js 15 App Router, the entire UI and API surface
- **`apps/desktop`** (`@flowscale/aios-desktop`) — Electron 39 shell that loads `apps/web` on port 14173
- **`packages/workflow`** (`@flowscale/workflow`) — zero-dependency library for ComfyUI workflow analysis; used by `apps/web`
- **`packages/sdk`** (`@flowscale/sdk`) — SDK for app developers building on top of tools
- **`packages/create-app`** — CLI scaffolding tool (`create-flowscale-aios-app`)
- **`example-apps/`** — sample app bundles for reference

## Architecture

### Data flow

All ComfyUI communication goes through Next.js API routes (CORS-free):
- `GET /api/comfy/scan` — TCP-probes ports **6188–16188** to find running ComfyUI instances
- `GET|POST /api/comfy/[port]/[...path]` — transparent proxy to `http://127.0.0.1:[port]/[path]`; uses `url.pathname` (not decoded route params) to preserve `%2F` encoding needed for ComfyUI's `/userdata` routes

Persistence is local SQLite at `~/.flowscale/aios.db` via Drizzle ORM + better-sqlite3. Schema is in `apps/web/src/lib/db/schema.ts`; the DB is initialised in `apps/web/src/lib/db/index.ts`.

> **Test DDL**: Integration tests use an in-memory SQLite DB built from a hand-written DDL in `apps/web/src/__tests__/integration/setup.ts`. When adding or renaming columns in `schema.ts`, also update that DDL or tests will fail with `SqliteError: no such column`.

### Database schema

Eleven tables (see `apps/web/src/lib/db/schema.ts` for Drizzle types):
- **`tools`** — saved tool definitions; `schemaJson` stores `WorkflowIO[]`; `layout` is `'left-right' | 'canvas'`; `status` is `'dev' | 'production'`; `engine` is `'comfyui' | 'api'`
- **`executions`** — run history per tool; cascades on tool delete; `status` is `'running' | 'completed' | 'error'`
- **`canvases`** — visual boards; viewport + settings stored as JSON strings; `isShared` bool
- **`canvas_items`** — draggable objects on a canvas; composite PK `(canvas_id, id)`; has `type`, `position`, `zIndex`, `locked`, `hidden`, `data`
- **`tool_configs`** — input/output visibility config keyed by `workflow_id`
- **`users`** — auth; `role` is `'admin' | 'pipeline_td' | 'dev' | 'artist'`; `status` is `'active' | 'pending' | 'disabled'`
- **`sessions`** — session tokens; FK → users
- **`setup`** — one-time initial admin password (seeded on first run)
- **`installed_apps`** — sideloaded or registry apps; `source` is `'sideloaded' | 'registry'`; `status` is `'active' | 'disabled'`; `bundlePath` points to `~/.flowscale/apps/[id]/`
- **`app_storage`** — per-app key-value storage; FK → installed_apps
- **`models`** — scanned local model files; `type` is `'checkpoint' | 'lora' | 'vae' | 'controlnet' | 'upscaler' | 'other'`

### Output storage

All tool execution outputs (both ComfyUI-engine and API-engine) are saved to `~/.flowscale/aios-outputs/[toolId]/[executionId_filename]` and served via `GET /api/outputs/[...path]`. The `outputsJson` column in `executions` stores items with a `path` field starting with `/api/outputs/...` — this is what the Assets page uses for display. Never trust a bare filename as a display URL; only `path` values starting with `/` are valid local paths.

When a ComfyUI-engine execution completes (`PATCH /api/executions/[id]` with `status: 'completed'`), `saveOutputsToDisk` downloads files from ComfyUI, writes them to disk, and re-writes `outputsJson` with updated `path` fields.

### App bundle system

Apps live in `~/.flowscale/apps/[id]/` — each directory must contain a `flowscale.app.json` manifest. The DB `installed_apps` table is the installation record; `GET /api/apps` filters out any rows whose `bundlePath` no longer exists on disk (deleted folder = silently removed from the grid, DB record preserved).

**App registry** (`apps/web/src/lib/registry/appRegistry.ts`) is filesystem-driven — it scans `~/.flowscale/apps/` at call time and builds `AppRegistryEntry` objects from each `flowscale.app.json`. There is no static registry JSON file.

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
- **`apps/web/src/store/notificationStore.ts`** — Zustand store for UI toast/snackbar notifications

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

- **Tools** — single-model/workflow endpoints (e.g. Z-Image-Turbo). Built via the Build Tool wizard, stored in the `tools` table, run via `/api/tools/[id]/executions`.
- **Apps** — full-fledged HTML bundles that orchestrate tools via the bridge protocol. Installed apps live in `~/.flowscale/apps/[id]/`; their DB record is in `installed_apps`; per-app state goes in `app_storage`.
- **Models** — local model files scanned from ComfyUI paths; listed via `/api/models`.
