# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start web app (Next.js, port 14173)
pnpm --filter @flowscale/aios-web dev

# Typecheck all workspaces
pnpm typecheck

# Run tests (vitest — workflow package has tests)
pnpm test
pnpm --filter @flowscale/workflow test
pnpm --filter @flowscale/workflow test:coverage

# Build all workspaces (turbo, respects dependency order)
pnpm build

# Build a single package
pnpm --filter @flowscale/workflow build
pnpm --filter @flowscale/aios-web build

# Start Electron desktop (must build first, and web must be running on 14173)
pnpm --filter @flowscale/aios-desktop build
apps/desktop/node_modules/.bin/electron apps/desktop/dist/main.js
```

Typecheck is the primary correctness tool — always run after changes. `packages/workflow` also has vitest tests.

## Repo Structure

Turborepo + pnpm workspaces with five packages:

- **`apps/web`** (`@flowscale/aios-web`) — Next.js 15 App Router, the entire UI and API surface
- **`apps/desktop`** (`@flowscale/aios-desktop`) — Electron 39 shell that loads `apps/web` on port 14173
- **`packages/workflow`** (`@flowscale/workflow`) — zero-dependency library for ComfyUI workflow analysis; used by `apps/web`
- **`packages/sdk`** (`@flowscale/sdk`) — SDK for app developers building on top of tools
- **`packages/create-app`** — CLI scaffolding tool (`create-flowscale-aios-app`)

## Architecture

### Data flow

All ComfyUI communication goes through Next.js API routes (CORS-free):
- `GET /api/comfy/scan` — TCP-probes ports **6188–16188** to find running ComfyUI instances
- `GET|POST /api/comfy/[port]/[...path]` — transparent proxy to `http://127.0.0.1:[port]/[path]`; uses `url.pathname` (not decoded route params) to preserve `%2F` encoding needed for ComfyUI's `/userdata` routes

Persistence is local SQLite at `~/.flowscale/aios.db` via Drizzle ORM + better-sqlite3. Schema is in `apps/web/src/lib/db/schema.ts`; the DB is initialised in `apps/web/src/lib/db/index.ts`.

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
- **`installed_apps`** — sideloaded or registry apps; `source` is `'sideloaded' | 'registry'`; `status` is `'active' | 'disabled'`
- **`app_storage`** — per-app key-value storage; FK → installed_apps
- **`models`** — scanned local model files; `type` is `'checkpoint' | 'lora' | 'vae' | 'controlnet' | 'upscaler' | 'other'`

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

### Local ComfyUI

ComfyUI is installed at `/home/silverion/projects/flowscale/ComfyUI/`.

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

## Product concepts

- **Tools** — single-model/workflow endpoints (e.g. Z-Image-Turbo). Built via the Build Tool wizard, stored in the `tools` table, run via `/api/tools/[id]/executions`.
- **Apps** — full-fledged Next.js/React applications that orchestrate multiple tools underneath via `@flowscale/sdk`. Apps are not tools; they are standalone products composed on top of tools. Installed apps are stored in `installed_apps`; per-app state goes in `app_storage`.
- **Models** — local model files scanned from ComfyUI paths; listed via `/api/models`.
