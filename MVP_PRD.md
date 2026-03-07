# FlowScale EIOS — MVP PRD

> **Scope:** Everything required to ship the MVP as defined in ECOSYSTEM_ARCHITECTURE.md and DEV_UX.md.
> The EIOS codebase already has: Build Tool wizard, tool execution (`/apps/[id]`), multi-user auth, ComfyUI scan/proxy, canvas, outputs page, and integrations UI.
> This PRD covers the **gaps only**.

---

## Problem Statement

EIOS can build and run ComfyUI-backed tools today, but it has no SDK, no app runtime, no cloud providers, and no real app registry. Developers cannot build React apps that call tools through a structured API. Apps cannot be isolated, distributed, or installed. The platform is a tool runner, not an app ecosystem.

## MVP Definition

A complete MVP means:
1. A developer can `npx create-flowscale-eios-app`, write a React app using `@flowscale/sdk`, and sideload it into EIOS for testing.
2. That app can call local registry tools (`tools.run`), cloud providers (`providers.fal`, etc.), and persist state (`storage.*`).
3. Apps run in iframe isolation with permission enforcement.
4. A user can browse a real app registry, install apps, and use them.
5. Model files are indexed so install dependency checks actually work.

---

## Epics Overview

| # | Epic | Phase |
|---|------|-------|
| E1 | `@flowscale/sdk` Package | 1 |
| E2 | Tool Registry (curated tools + execution pipeline) | 1 |
| E3 | Cloud Providers | 1 |
| E4 | App Runtime (iframe sandbox + bridge) | 2 |
| E5 | App Storage | 2 |
| E6 | Sideloading + CLI | 2 |
| E7 | App Registry + Install Flow | 3 |
| E8 | Local Models Registry | 3 |

---

## Epic E1 — `@flowscale/sdk` Package

**Goal:** A TypeScript SDK that app developers import. In iframe mode it communicates with the EIOS host via postMessage. Standalone mode it talks directly to the EIOS API (for dev/testing).

---

### Story E1.1 — SDK package scaffold

**As a developer, I can install `@flowscale/sdk` and import from it.**

- [ ] Create `packages/sdk/` in the eios turborepo root
- [ ] Add `packages/sdk/package.json`: name `@flowscale/sdk`, version `1.0.0`, `main: dist/index.js`, `types: dist/index.d.ts`, exports map
- [ ] Add `packages/sdk/tsconfig.json` extending root, `"declaration": true`, `"outDir": "dist"`
- [ ] Add `tsup` build config: `entry: ['src/index.ts']`, `format: ['cjs', 'esm']`, `dts: true`
- [ ] Add `packages/sdk` to `pnpm-workspace.yaml`
- [ ] Add `"@flowscale/sdk": "workspace:*"` to `apps/web/package.json`
- [ ] Add sdk build step to `turbo.json` pipeline under `build`
- [ ] Run `pnpm install` and confirm package resolves in `apps/web`

---

### Story E1.2 — Core types

**As a developer, I have full TypeScript types for all SDK interfaces.**

- [ ] Create `packages/sdk/src/types.ts` with:
  - `ParamDef`: `{ type: 'string'|'number'|'boolean'|'image'|'select', required?, default?, description?, options?, min?, max? }`
  - `Tool`: `{ id, name, description, source: 'registry'|'custom', inputs: Record<string, ParamDef>, outputs: Record<string, ParamDef> }`
  - `ToolResult`: `{ id, toolId, status: 'completed'|'error', outputs: Record<string, any>, duration: number, error? }`
  - `ProgressEvent`: `{ progress: number, status: string, preview?: string, result?: ToolResult }`
  - `AppContext`: `{ appId: string, userId: string | null, permissions: string[] }`
  - `ThemeTokens`: `{ colors: Record<string, string>, fonts: Record<string, string>, spacing: Record<string, string>, radii: Record<string, string> }`
  - `AppManifest`: `{ name, displayName, description, version, sdk, entry, icon?, tools_used?, permissions: string[], custom_tools?, capabilities: { slots: string[] } }`
  - `ProviderInfo`: `{ name: string, configured: boolean }`
  - `FileInfo`: `{ path: string, size: number, contentType: string, createdAt: number }`

---

### Story E1.3 — postMessage bridge client

**As the SDK internals, I can send JSON-RPC 2.0 requests to the host and await responses.**

- [ ] Create `packages/sdk/src/bridge.ts`
- [ ] Implement `isIframe(): boolean` — `window.parent !== window`
- [ ] Implement `request(method: string, params: unknown): Promise<unknown>`:
  - Generate UUID `id`
  - If iframe: `window.parent.postMessage({ jsonrpc: '2.0', method, params, id }, '*')`
  - Add listener for response matching `id`; resolve/reject accordingly
  - Reject with `REQUEST_TIMEOUT` after 30s
  - If not iframe (standalone mode): `POST /api/sdk-bridge` with `{ method, params }`; return response
- [ ] Implement `subscribe(requestId: string, onEvent: (params: unknown) => void): () => void`:
  - Listens for `{ jsonrpc: '2.0', method: 'stream.event', params: { requestId, ...} }` from host
  - Returns unsubscribe function
- [ ] Handle host error shape: `{ error: { code, message, data? } }` → throw typed error

---

### Story E1.4 — `tools.*` API

**As an app developer, I can call `tools.run('sdxl-txt2img', inputs)` and get a structured result.**

- [ ] Create `packages/sdk/src/tools.ts`
- [ ] `tools.list(): Promise<Tool[]>` — `request('tools.list', {})`
- [ ] `tools.registry(): Promise<Tool[]>` — `request('tools.registry', {})`
- [ ] `tools.get(toolId: string): Promise<Tool>` — `request('tools.get', { toolId })`
- [ ] `tools.run(toolId: string, inputs: Record<string, any>): Promise<ToolResult>` — `request('tools.run', { toolId, inputs })`
- [ ] `tools.stream(toolId: string, inputs: Record<string, any>): AsyncIterable<ProgressEvent>`:
  - `request('tools.stream', { toolId, inputs })` returns `{ requestId }`
  - Use `subscribe(requestId, ...)` to yield events
  - Complete async iterator when event has `result` field

---

### Story E1.5 — `providers.*` API

**As an app developer, I can call cloud providers through the host without seeing API keys.**

- [ ] Create `packages/sdk/src/providers.ts`
- [ ] `providers.fal(endpoint: string, params: Record<string, any>): Promise<any>` — `request('providers.fal', { endpoint, params })`
- [ ] `providers.replicate(model: string, params: Record<string, any>): Promise<any>` — `request('providers.replicate', { model, params })`
- [ ] `providers.openrouter(model: string, params: Record<string, any>): Promise<any>` — `request('providers.openrouter', { model, params })`
- [ ] `providers.huggingface(model: string, params: Record<string, any>): Promise<any>` — `request('providers.huggingface', { model, params })`
- [ ] `providers.list(): Promise<ProviderInfo[]>` — `request('providers.list', {})`
- [ ] Export error codes as constants: `PROVIDER_NOT_CONFIGURED`, `PROVIDER_ERROR`

---

### Story E1.6 — `storage.*` API

**As an app developer, I can persist key-value data and write files scoped to my app.**

- [ ] Create `packages/sdk/src/storage.ts`
- [ ] `storage.get<T>(key: string): Promise<T | null>` — `request('storage.get', { key })`
- [ ] `storage.set<T>(key: string, value: T): Promise<void>` — `request('storage.set', { key, value })`
- [ ] `storage.delete(key: string): Promise<void>` — `request('storage.delete', { key })`
- [ ] `storage.list(prefix?: string): Promise<string[]>` — `request('storage.list', { prefix })`
- [ ] `storage.files.write(path: string, data: Blob | ArrayBuffer): Promise<string>` — serialises to base64, `request('storage.files.write', { path, data })`
- [ ] `storage.files.read(path: string): Promise<Blob>` — `request('storage.files.read', { path })`, deserialise base64 → Blob
- [ ] `storage.files.delete(path: string): Promise<void>` — `request('storage.files.delete', { path })`
- [ ] `storage.files.list(dir?: string): Promise<FileInfo[]>` — `request('storage.files.list', { dir })`

---

### Story E1.7 — `ui.*` and `app.*` APIs

**As an app developer, I can trigger host notifications, confirm dialogs, read theme tokens, and handle lifecycle events.**

- [ ] Create `packages/sdk/src/ui.ts`:
  - `ui.showNotification(opts: { type: 'success'|'error'|'info', message: string }): void` — fire-and-forget `request`
  - `ui.confirm(opts: { title: string, message: string }): Promise<boolean>` — awaited `request`
  - `ui.theme.get(): Promise<ThemeTokens>` — `request('ui.theme.get', {})`
- [ ] Create `packages/sdk/src/app.ts`:
  - `app.on('activate' | 'deactivate', cb: () => void): void` — subscribe to bridge notification
  - `app.getContext(): Promise<AppContext>` — `request('app.getContext', {})`
- [ ] Create `packages/sdk/src/index.ts` barrel: export `tools`, `providers`, `storage`, `ui`, `app`, all types from `types.ts`

---

## Epic E2 — Tool Registry

**Goal:** ~10 curated tools with tested ComfyUI workflows, proper schemas, and model dependency checking, callable via `tools.run()`.

---

### Story E2.1 — Registry file structure and types

**As the platform, I have a versioned, typed registry of curated tools.**

- [ ] Create `apps/web/src/lib/registry/` directory
- [ ] Create `apps/web/src/lib/registry/types.ts`:
  - `RegistryTool`: `{ id, name, description, category, version, schema: { inputs: Record<string, ParamDef>, outputs: Record<string, ParamDef> }, execution: { workflowFile: string, models_required: string[], custom_nodes_required: string[] } }`
- [ ] Create `apps/web/src/lib/registry/tools/` for per-tool definition files (`.ts` each)
- [ ] Create `apps/web/src/lib/registry/workflows/` for ComfyUI workflow JSON files
- [ ] Create `apps/web/src/lib/registry/index.ts`: exports `REGISTRY_TOOLS: RegistryTool[]` (imports all tool definitions)

---

### Story E2.2 — Curate 10 registry tool definitions

**As a developer, I can discover and call 10 pre-configured tools without building anything custom.**

One subtask per tool — each needs a typed definition + a tested ComfyUI workflow JSON:

- [ ] `sdxl-txt2img`: inputs `prompt(string,req), negative_prompt(string), width(number,1024), height(number,1024), seed(number,-1), steps(number,20), cfg_scale(number,7)` → outputs `images(image[])`; models_required: `['sd_xl_base_1.0.safetensors']`
- [ ] `sdxl-img2img`: inputs `image(image,req), prompt(string,req), denoise(number,0.7), seed(number,-1), steps(number,20)` → outputs `images(image[])`; models_required: `['sd_xl_base_1.0.safetensors']`
- [ ] `flux-dev-txt2img`: inputs `prompt(string,req), width(number,1024), height(number,1024), seed(number,-1), steps(number,20), guidance(number,3.5)` → outputs `images(image[])`; models_required: `['flux1-dev.safetensors']`
- [ ] `flux-schnell-txt2img`: inputs `prompt(string,req), width(number,1024), height(number,1024), seed(number,-1), steps(number,4)` → outputs `images(image[])`; models_required: `['flux1-schnell.safetensors']`
- [ ] `remove-background`: inputs `image(image,req)` → outputs `image(image)`; models_required: `['RMBG-2.0.pth']`
- [ ] `upscale-4x`: inputs `image(image,req), model(select,default:'RealESRGAN_x4plus', options:[...])` → outputs `image(image)`; models_required: `['RealESRGAN_x4plus.pth']`
- [ ] `controlnet-depth`: inputs `image(image,req), prompt(string,req), strength(number,0.8), seed(number,-1), steps(number,20)` → outputs `images(image[])`; models_required: `['sd_xl_base_1.0.safetensors','diffusers_xl_depth_full.safetensors']`
- [ ] `face-restore`: inputs `image(image,req), fidelity(number,0.7)` → outputs `image(image)`; models_required: `['codeformer.pth']`
- [ ] `inpaint-sdxl`: inputs `image(image,req), mask(image,req), prompt(string,req), seed(number,-1), steps(number,20)` → outputs `images(image[])`; models_required: `['sd_xl_base_1.0.safetensors']`
- [ ] `img2vid-svd`: inputs `image(image,req), frames(number,14), fps(number,6), motion_bucket_id(number,127), seed(number,-1)` → outputs `video`; models_required: `['svd_xt.safetensors']`
- [ ] For each tool: write and manually test workflow JSON in `registry/workflows/`
- [ ] For each tool: document exact model filenames expected in ComfyUI model dirs

---

### Story E2.3 — Model dependency checking

**As the platform, I can determine which registry tool models are present on the user's machine.**

- [ ] Create `apps/web/src/lib/registry/modelChecker.ts`
- [ ] Implement `checkModelAvailability(modelsRequired: string[], comfyPort: number): Promise<Record<string, boolean>>`:
  - `GET http://localhost:{port}/models/checkpoints` (+ `/loras`, `/vae`, `/controlnet`, `/upscale_models`)
  - Flatten all filenames returned
  - For each `modelsRequired[i]`: check if filename exists (case-insensitive, basename match)
  - Return `{ 'sd_xl_base_1.0.safetensors': true, 'flux1-dev.safetensors': false, ... }`
- [ ] Create `GET /api/tools/registry` route:
  - Returns `REGISTRY_TOOLS` serialised as SDK `Tool[]` (schema only, no `execution` block)
  - Optional `?comfyPort=8188` query param: if provided, run `checkModelAvailability()` per tool and include `available: boolean`, `missing_models: string[]`
- [ ] Write unit tests in `src/lib/__tests__/modelChecker.test.ts` (mock ComfyUI responses)

---

### Story E2.4 — Registry execution pipeline

**As the bridge host, when `tools.run` is called with a registry tool ID, I execute it via ComfyUI.**

- [ ] Create `apps/web/src/lib/registry/executor.ts`
- [ ] Implement `executeRegistryTool(toolId: string, inputs: Record<string, any>, comfyPort: number, clientId: string, apiKey?: string): Promise<{ promptId: string }>`:
  - Look up `toolId` in `REGISTRY_TOOLS`; throw `TOOL_NOT_FOUND` if missing
  - Load workflow JSON from `registry/workflows/{tool.execution.workflowFile}`
  - Use existing `comfyui-tool-mapper.ts` logic to inject `inputs` into workflow nodes
  - Call `queuePrompt(workflow, clientId, baseUrl, apiKey)` from `comfyui-client.ts`
  - Return `{ promptId }`
- [ ] In the bridge server `tools.run` handler (see E4.5): if toolId is in `REGISTRY_TOOLS` → call `executeRegistryTool`; else → use existing custom tool pipeline from `apps/[id]` page logic
- [ ] In the bridge server `tools.stream` handler: same execution, but push `ProgressEvent` notifications via the WebSocket at `/api/comfy/{port}/ws` (poll every 500ms, emit `{ progress, status, preview? }`)

---

## Epic E3 — Cloud Providers

**Goal:** Apps can call fal.ai, Replicate, OpenRouter, and HuggingFace through the host. API keys are stored server-side only.

---

### Story E3.1 — Provider key storage

**As the platform, I store provider API keys server-side and never expose them to iframes.**

- [ ] Create `apps/web/src/lib/providerSettings.ts`:
  - `PROVIDER_KEYS_PATH = path.join(os.homedir(), '.flowscale', 'eios', 'provider-keys.json')`
  - `getProviderKey(provider: 'fal'|'replicate'|'openrouter'|'huggingface'): string | null` — reads file, returns key or null
  - `setProviderKey(provider, key: string): void` — reads file, updates entry, writes file; creates dirs if needed
  - `listProviders(): ProviderInfo[]` — returns `[{ name, configured: boolean }]` without key values

---

### Story E3.2 — Provider settings UI

**As an admin, I can enter and save API keys for each cloud provider in Settings.**

- [ ] Add "Providers" section to `apps/web/src/app/(main)/settings/page.tsx`:
  - `useQuery(['providers'], () => fetch('/api/providers').then(r => r.json()))`
  - Render a row per provider (fal.ai, Replicate, OpenRouter, HuggingFace):
    - Status badge: green "configured" or grey "not set"
    - Masked password input + Save button
  - On Save: `POST /api/providers/{name}/key` with `{ key }`; invalidate `['providers']` query
- [ ] Create `GET /api/providers` route: returns `listProviders()` — keys are never included
- [ ] Create `POST /api/providers/[name]/key` route: calls `setProviderKey(name, key)`, returns `{ ok: true }`
- [ ] Gate providers section to `admin` and `pipeline_td` roles (check `user.role` from session)

---

### Story E3.3 — Provider proxy API routes

**As the platform, I proxy provider calls server-side, injecting stored API keys.**

- [ ] Create `POST /api/providers/fal/[...endpoint]` route:
  - Read key via `getProviderKey('fal')`; return `{ code: 'PROVIDER_NOT_CONFIGURED' }` (400) if null
  - `POST https://queue.fal.run/{endpoint}` with `Authorization: Key {key}` + body passthrough
  - Poll `GET https://queue.fal.run/{endpoint}/requests/{request_id}` with same auth until `status === 'COMPLETED'|'FAILED'` (max 5min, 2s interval)
  - Return final result or `{ code: 'PROVIDER_ERROR', providerError }` (502)
- [ ] Create `POST /api/providers/replicate` route:
  - Body: `{ model: string, params: Record<string, any> }`
  - `POST https://api.replicate.com/v1/predictions` with `Authorization: Token {key}`, `{ version: model, input: params }`
  - Poll `/v1/predictions/{id}` until `status === 'succeeded'|'failed'` (max 5min, 2s interval)
  - Return `prediction.output` or `{ code: 'PROVIDER_ERROR', providerError }`
- [ ] Create `POST /api/providers/openrouter` route:
  - Proxy `POST https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer {key}` + body passthrough
  - Return response JSON or `{ code: 'PROVIDER_ERROR', providerError }`
- [ ] Create `POST /api/providers/huggingface` route:
  - Body: `{ model: string, params: Record<string, any> }`
  - Proxy `POST https://api-inference.huggingface.co/models/{model}` with `Authorization: Bearer {key}` + `params` as body
  - Return response JSON or `{ code: 'PROVIDER_ERROR', providerError }`
- [ ] All routes: validate `Content-Type`, sanitise model/endpoint path params to prevent SSRF (allowlist `https://` prefixes only)

---

## Epic E4 — App Runtime (iframe sandbox + bridge)

**Goal:** Third-party apps run in isolated iframes. The host intercepts all SDK calls via postMessage, enforces permissions, and routes to the appropriate backend.

---

### Story E4.1 — DB schema: `installed_apps` + `app_storage`

**As the platform, I persist installed app metadata and app-scoped key-value data.**

- [ ] Add to `apps/web/src/lib/db/schema.ts`:
  ```ts
  export const installedApps = sqliteTable('installed_apps', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    displayName: text('display_name').notNull(),
    bundlePath: text('bundle_path').notNull(),
    entryPath: text('entry_path').notNull(),
    manifestJson: text('manifest_json').notNull(),
    source: text('source').notNull().default('registry'), // 'registry' | 'sideloaded'
    status: text('status').notNull().default('active'),
    installedAt: integer('installed_at').notNull().default(sql`(unixepoch() * 1000)`),
  })

  export const appStorage = sqliteTable('app_storage', {
    appId: text('app_id').notNull().references(() => installedApps.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  }, (t) => [primaryKey({ columns: [t.appId, t.key] })])
  ```
- [ ] Export `InstalledApp` and `AppStorageRow` types
- [ ] Add `CREATE TABLE IF NOT EXISTS installed_apps (...)` and `app_storage (...)` in `apps/web/src/lib/db/index.ts` `initSchema()` function (follow the existing pattern)

---

### Story E4.2 — App manifest validation

**As the platform, I can parse and validate a `flowscale.app.json` manifest.**

- [ ] Create `apps/web/src/lib/appManifest.ts`
- [ ] Implement `parseManifest(json: unknown): AppManifest`:
  - Assert required fields: `name`, `displayName`, `version`, `sdk`, `entry`, `permissions`, `capabilities`
  - Validate `permissions` against allowed set: `['tools', 'providers:fal', 'providers:replicate', 'providers:openrouter', 'providers:huggingface', 'storage:readwrite', 'storage:files']`
  - Validate `capabilities.slots` elements against `['main-app', 'canvas-plugin', 'tool-panel']`
  - Throw descriptive `Error` on validation failure
- [ ] Write unit tests in `src/lib/__tests__/appManifest.test.ts`: valid manifest, missing required field, invalid permission, invalid slot

---

### Story E4.3 — App bundle serving

**As the platform, I serve installed app bundle files so the iframe can load them.**

- [ ] Create `GET /api/apps/[id]/bundle/[...path]` route:
  - Look up app in `installed_apps` by `id`; return 404 if not found
  - Resolve `bundlePath + '/' + path.join(...segments)` — reject paths containing `..` (return 403)
  - Read file from disk; respond with correct `Content-Type` header (infer from extension)
  - Cache-Control: `no-cache` for sideloaded apps (hot reload), `max-age=3600` for registry apps
- [ ] Create `GET /api/apps` route: `SELECT * FROM installed_apps WHERE status='active'` with parsed manifests
- [ ] Create `GET /api/apps/[id]` route: single app record + parsed manifest

---

### Story E4.4 — `AppFrame` React component

**As the host, I render a third-party app in an isolated iframe and wire up the bridge.**

- [ ] Create `apps/web/src/components/AppFrame.tsx`:
  - Props: `appId: string`, `manifest: AppManifest`, `userId: string | null`, `className?: string`
  - Renders `<iframe src="/api/apps/{appId}/bundle/{entryFile}" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />`
  - `ref` on iframe to get `contentWindow`
  - On mount: `window.addEventListener('message', handleMessage)` where `handleMessage` checks `event.source === iframeRef.current?.contentWindow`
  - On unmount: remove listener, clean up `BridgeServer`
  - `BridgeServer` instance created in `useEffect` with `appId`, `manifest`, `userId`

---

### Story E4.5 — Bridge server (host side)

**As the host, I handle all JSON-RPC method calls from app iframes, enforcing permissions.**

- [ ] Create `apps/web/src/lib/bridge/server.ts`
- [ ] Implement `class BridgeServer`:
  - Constructor: `(appId: string, manifest: AppManifest, userId: string | null, send: (msg: object) => void)`
  - `respond(id, result)`: `send({ jsonrpc:'2.0', result, id })`
  - `error(id, code, message)`: `send({ jsonrpc:'2.0', error: { code, message }, id })`
  - `notify(method, params)`: `send({ jsonrpc:'2.0', method, params })` (no id — for streaming)
  - `checkPermission(required: string): boolean`: `manifest.permissions.includes(required)`
  - `dispatch(message: unknown): Promise<void>`: parse JSON-RPC, route to handler:

| Method | Permission required | Handler |
|--------|-------------------|---------|
| `tools.list` | none | fetch `/api/tools?status=production` + `/api/tools/registry` |
| `tools.registry` | none | fetch `/api/tools/registry` |
| `tools.get` | none | fetch `/api/tools/{toolId}` or registry lookup |
| `tools.run` | `tools` | `POST /api/bridge/tools/run` |
| `tools.stream` | `tools` | `POST /api/bridge/tools/stream` → push notify |
| `providers.fal` | `providers:fal` | `POST /api/providers/fal/{endpoint}` |
| `providers.replicate` | `providers:replicate` | `POST /api/providers/replicate` |
| `providers.openrouter` | `providers:openrouter` | `POST /api/providers/openrouter` |
| `providers.huggingface` | `providers:huggingface` | `POST /api/providers/huggingface` |
| `providers.list` | none | fetch `/api/providers` |
| `storage.get/set/delete/list` | `storage:readwrite` | `POST /api/bridge/storage` |
| `storage.files.*` | `storage:files` | `POST /api/bridge/storage/files` |
| `ui.showNotification` | none | emit to host notification store |
| `ui.confirm` | none | show host confirm modal, resolve with user's choice |
| `ui.theme.get` | none | return hardcoded theme tokens |
| `app.getContext` | none | return `{ appId, userId, permissions: manifest.permissions }` |

- [ ] Write unit tests in `src/lib/__tests__/bridgeServer.test.ts`: permission allow, permission deny, unknown method returns error

---

### Story E4.6 — Bridge API routes (server-side execution)

**As the bridge, I execute tool runs and storage operations on behalf of an app.**

- [ ] Create `POST /api/bridge/tools/run` route:
  - Require valid session (standard `getSessionUser()` check)
  - Body: `{ appId: string, toolId: string, inputs: Record<string, any> }`
  - Verify `appId` is in `installed_apps`; verify app has `tools` permission in manifest
  - If `toolId` in `REGISTRY_TOOLS`: call `executeRegistryTool(toolId, inputs, comfyPort, clientId)`
  - Else: look up in `tools` table (custom/deployed tools), run existing ComfyUI pipeline
  - Create row in `executions` table with `userId` from session
  - Return `ToolResult`
- [ ] Create `POST /api/bridge/storage` route:
  - Body: `{ appId, action: 'get'|'set'|'delete'|'list', key?, value?, prefix? }`
  - `get`: `SELECT value FROM app_storage WHERE app_id=? AND key=?` → return parsed JSON or null
  - `set`: upsert into `app_storage`; set `updated_at = Date.now()`
  - `delete`: `DELETE FROM app_storage WHERE app_id=? AND key=?`
  - `list`: `SELECT key FROM app_storage WHERE app_id=? AND key LIKE ?||'%'`
- [ ] Create file storage routes (see E5)

---

### Story E4.7 — App slot: `main-app`

**As a user, installed apps with `capabilities.slots: ['main-app']` appear in the sidebar and open in the main view.**

- [ ] Update `apps/web/src/app/(main)/_Sidebar.tsx`:
  - Add `useQuery(['installed-apps'], () => fetch('/api/apps').then(r => r.json()))` (no loading state needed in sidebar)
  - Filter for `manifest.capabilities.slots.includes('main-app')`
  - Append these apps to `navItems` with `href: '/installed-apps/{id}'`
- [ ] Create `apps/web/src/app/(main)/installed-apps/[id]/page.tsx`:
  - Fetch app from `/api/apps/{id}`
  - Parse manifest
  - Render `<AppFrame appId={id} manifest={manifest} userId={session.userId} className="w-full h-full" />`
  - Get current `userId` from `GET /api/auth/me`

---

## Epic E5 — App File Storage Backend

**Goal:** `storage.files.*` SDK calls persist files in a per-app sandboxed directory.**

---

### Story E5.1 — File storage API routes

**As an app, `storage.files.write/read/delete/list` work correctly and are sandboxed to my appId.**

- [ ] Create `POST /api/bridge/storage/files/write` route:
  - Body: `{ appId: string, path: string, data: string }` (data is base64)
  - Resolve target: `~/.flowscale/eios/app-data/{appId}/{path}`
  - Reject paths with `..` or absolute paths (return 400)
  - `mkdir -p` the parent directory
  - Write `Buffer.from(data, 'base64')` to file
  - Return `{ url: '/api/bridge/storage/files/read?appId=...&path=...' }`
- [ ] Create `GET /api/bridge/storage/files/read` route:
  - Query: `appId`, `path`
  - Same sandboxing validation
  - Read file; set `Content-Type` from extension; stream response
- [ ] Create `DELETE /api/bridge/storage/files/delete` route:
  - Body: `{ appId, path }`
  - Same sandboxing; unlink file
- [ ] Create `GET /api/bridge/storage/files/list` route:
  - Query: `appId`, `dir?`
  - `readdir` the resolved directory
  - Return `FileInfo[]`: `{ path, size, contentType, createdAt }`

---

## Epic E6 — Sideloading + CLI

**Goal:** Developers can load a local app build into EIOS for testing, with hot reload. A CLI scaffolds new apps instantly.

---

### Story E6.1 — Sideload UI in Settings

**As a developer, I can load a local app directory into EIOS from Settings > Developer.**

- [ ] Add "Developer" tab to `apps/web/src/app/(main)/settings/page.tsx`
- [ ] Gate the tab to `dev` and `admin` roles (check `user.role`; update `ROLE_NAV` in `auth.ts` to include `/settings` for `dev` already does — confirm)
- [ ] Add "Load app from path" button:
  - Desktop mode: call `window.desktop?.dialog?.openFile({ properties: ['openDirectory'] })` → returns path
  - Browser mode: show text `<input>` for absolute path (assumes local server)
- [ ] Create `POST /api/apps/sideload` route:
  - Body: `{ path: string }` (absolute path to app dist directory)
  - Read `{path}/flowscale.app.json`; throw if missing
  - Call `parseManifest()` — return 400 with validation error if invalid
  - Upsert into `installed_apps`: `source: 'sideloaded'`, `bundlePath: path`, `entryPath: manifest.entry`
  - Return inserted app record
- [ ] Show list of sideloaded apps in Developer tab:
  - `useQuery(['sideloaded-apps'], () => fetch('/api/apps?source=sideloaded').then(r => r.json()))`
  - Per app: name, path, "Remove" button
- [ ] Add `?source=sideloaded` filter support to `GET /api/apps` route
- [ ] Create `DELETE /api/apps/[id]` route: delete from `installed_apps` (no bundle file deletion)
- [ ] Add `dialog:openDirectory` handler in `apps/desktop/src/ipc/dialog.ts` (extend existing `dialog:openFile` IPC handler; add `properties: ['openDirectory']` option)

---

### Story E6.2 — Sideload hot reload (desktop only)

**As a developer, EIOS auto-refreshes my sideloaded app when I rebuild without manual re-sideload.**

- [ ] Add `watch:start` and `watch:stop` IPC handlers in `apps/desktop/src/main.ts`:
  - `watch:start(path)`: `fs.watch(path, { recursive: true }, debounced_handler)` — debounce 500ms — send `app-dir-changed` event to renderer
  - `watch:stop(path)`: close the watcher for that path
- [ ] Expose in `apps/desktop/src/preload.ts`:
  - `window.desktop.watch.start(path: string, cb: () => void): void`
  - `window.desktop.watch.stop(path: string): void`
- [ ] Add to `apps/web/src/types/desktop.d.ts`: `watch: { start(path: string, cb: () => void): void; stop(path: string): void }`
- [ ] In `AppFrame.tsx`: if `source === 'sideloaded'` and `window.desktop?.watch` exists:
  - `useEffect`: call `window.desktop.watch.start(manifest.bundlePath, () => iframeRef.current?.contentWindow?.location.reload())`
  - Cleanup: call `window.desktop.watch.stop(manifest.bundlePath)`

---

### Story E6.3 — `create-flowscale-eios-app` CLI

**As a developer, I can scaffold a new EIOS app in one command: `npx create-flowscale-eios-app my-app`.**

- [ ] Create `packages/create-app/` directory
- [ ] Add `packages/create-app/package.json`: name `create-flowscale-eios-app`, `bin: { 'create-flowscale-eios-app': './index.js' }`, `files: ['index.js', 'template']`
- [ ] Create `packages/create-app/index.js` (plain Node, no build):
  - Reads `process.argv[2]` as app name; exits with usage message if missing
  - `fs.cpSync('template/', path.join(process.cwd(), appName), { recursive: true })`
  - Replaces `__APP_NAME__` token in `package.json` and `flowscale.app.json` with `appName`
  - Prints "Done! cd {name} && npm install && npm run dev"
- [ ] Create `packages/create-app/template/flowscale.app.json`:
  ```json
  {
    "name": "__APP_NAME__",
    "displayName": "__APP_NAME__",
    "description": "A FlowScale EIOS app",
    "version": "1.0.0",
    "sdk": "^1.0.0",
    "entry": "dist/index.html",
    "permissions": ["tools", "storage:readwrite"],
    "capabilities": { "slots": ["main-app"] }
  }
  ```
- [ ] Create `packages/create-app/template/package.json`: `@flowscale/sdk` dep, `vite`, `react`, `react-dom`, `typescript` devDeps
- [ ] Create `packages/create-app/template/vite.config.ts`: `base: './'`, `build.outDir: 'dist'`
- [ ] Create `packages/create-app/template/src/main.tsx`: React 18 root mount
- [ ] Create `packages/create-app/template/src/App.tsx`: minimal example — text input, button calling `tools.run('sdxl-txt2img', { prompt })`, displays result image
- [ ] Create `packages/create-app/template/tsconfig.json`, `.gitignore`, `README.md`

---

## Epic E7 — App Registry + Install Flow

**Goal:** Users browse a real app registry, install apps with dependency checks, and see them in the sidebar.

---

### Story E7.1 — Registry format

**As the platform, I have a machine-readable app registry file.**

- [ ] Create `apps/web/src/lib/registry/appRegistry.ts` with type:
  ```ts
  interface AppRegistryEntry {
    id: string
    name: string
    displayName: string
    description: string
    category: string
    author: string
    repository: string         // GitHub repo URL
    latestRelease: string      // semver e.g. "1.0.0"
    releaseAssetUrl: string    // direct URL to dist .zip
    icon?: string              // URL to icon
    screenshots?: string[]
    tools_used?: string[]      // registry tool IDs required
    permissions: string[]
    capabilities: { slots: string[] }
  }
  ```
- [ ] Create `apps/web/src/lib/registry/appRegistry.json` — seed with 2–3 internal example apps (point `releaseAssetUrl` to real GitHub releases or local fixture URLs for MVP)
- [ ] Create `GET /api/apps/registry` route: returns the JSON (in future: fetch from remote URL and cache 1h; for MVP read from file)
- [ ] Create `GET /api/apps/registry/[id]` route: single registry entry or 404

---

### Story E7.2 — Install flow with dependency checks

**As a user, clicking Install runs dependency checks before downloading and registering the app.**

- [ ] Create `apps/web/src/lib/installer.ts`:
  - `checkInstallDeps(entry: AppRegistryEntry, comfyPort: number): Promise<InstallCheckResult>`:
    - For each `tools_used`: check if registry tool is available + `checkModelAvailability(tool.models_required, comfyPort)`
    - For each `providers:*` permission: check `getProviderKey(provider) !== null`
    - Returns `{ ok: boolean, missingModels: string[], unconfiguredProviders: string[] }`
- [ ] Create `POST /api/apps/install` route:
  - Body: `{ registryId: string, force?: boolean }`
  - Fetch registry entry from `/api/apps/registry/{registryId}`
  - Run `checkInstallDeps()`; if not ok and `!force` return check result (200 with `status:'missing_deps'`)
  - Download `entry.releaseAssetUrl` to `/tmp/flowscale-install-{registryId}.zip`
  - Unzip to `~/.flowscale/eios/apps/{registryId}/` using Node `child_process.execSync('unzip ...')` or `adm-zip`
  - Parse + validate `flowscale.app.json` from unzipped bundle
  - Deploy any `custom_tools` from manifest (call existing `/api/tools` POST for each)
  - Upsert into `installed_apps`: `source: 'registry'`, `bundlePath`, `entryPath`
  - Return `{ status: 'installed', app: InstalledApp }`
- [ ] Create `apps/web/src/components/InstallModal.tsx`:
  - Props: `entry: AppRegistryEntry`, `onClose: () => void`
  - Step 1: App info card + permissions list
  - Step 2 (on click "Check & Install"): show spinner, `POST /api/apps/install` without `force`; if missing deps show list with red/green indicators and "Install anyway" / "Cancel" buttons
  - Step 3: progress bar during download; success state with "Open App" button on completion
- [ ] Add `adm-zip` (or `unzipper`) to `apps/web/package.json` if not present

---

### Story E7.3 — Real Explore page

**As a user, the Explore page shows real apps from the registry, not hardcoded placeholders.**

- [ ] Rewrite `apps/web/src/app/(main)/explore/page.tsx`:
  - `useQuery(['app-registry'])`: fetch `/api/apps/registry`
  - `useQuery(['installed-apps'])`: fetch `/api/apps`
  - Compute `installedSet = new Set(installedApps.map(a => a.id))`
  - Render app cards from registry:
    - If `installedSet.has(entry.id)`: "Open" button → `router.push('/installed-apps/{id}')`
    - Else: "Install" button → `setInstallTarget(entry)` which opens `<InstallModal>`
  - Group by category
  - Remove all hardcoded `INSTALLED_APPS` and `COMING_SOON_APPS` arrays
- [ ] `<InstallModal>` mounted at bottom of `ExplorePage` when `installTarget !== null`

---

## Epic E8 — Local Models Registry

**Goal:** EIOS indexes model files from ComfyUI instances so dependency checks are reliable and users can browse what's installed.

---

### Story E8.1 — DB schema: `models`

**As the platform, I persist a scanned index of local model files.**

- [ ] Add to `apps/web/src/lib/db/schema.ts`:
  ```ts
  export const models = sqliteTable('models', {
    id: text('id').primaryKey(),               // sha256 of absolute path
    filename: text('filename').notNull(),
    path: text('path').notNull().unique(),
    type: text('type').notNull(),              // 'checkpoint'|'lora'|'vae'|'controlnet'|'upscaler'|'other'
    sizeBytes: integer('size_bytes'),
    comfyPort: integer('comfy_port'),
    scannedAt: integer('scanned_at').notNull().default(sql`(unixepoch() * 1000)`),
  })
  ```
- [ ] Export `ModelRow` type
- [ ] Add `CREATE TABLE IF NOT EXISTS models (...)` in `db/index.ts` `initSchema()`

---

### Story E8.2 — Model scan API

**As the platform, I scan ComfyUI model directories and populate the models index.**

- [ ] Create `apps/web/src/lib/modelScanner.ts`:
  - `scanComfyModels(comfyPort: number): Promise<ModelScanResult[]>`:
    - `GET http://localhost:{port}/models/checkpoints` → `[{ name, ... }]` → map to `{ filename: name, type: 'checkpoint' }`
    - Repeat for `/models/loras` → `lora`, `/models/vae` → `vae`, `/models/controlnet` → `controlnet`, `/models/upscale_models` → `upscaler`
    - Combine; generate `id = crypto.createHash('sha256').update('{port}:{filename}').digest('hex')`
    - Return `{ id, filename, type, comfyPort: port }`
- [ ] Create `POST /api/models/scan` route:
  - Body: `{ comfyPort: number }`
  - Call `scanComfyModels(port)`
  - Upsert into `models` table (insert or replace by `path`)
  - Return `{ count: number }`
- [ ] Trigger background scan: in `GET /api/comfy/scan/route.ts`, after collecting `instances`, fire `Promise.allSettled(instances.map(i => fetch('/api/models/scan', { method:'POST', body: JSON.stringify({comfyPort: i.port}) })))` without awaiting (best-effort, fire-and-forget)
- [ ] Update `checkModelAvailability()` in `modelChecker.ts`:
  - First try DB: `SELECT filename FROM models WHERE filename = ?` (case-insensitive)
  - Fallback to live ComfyUI API if DB returns no results
- [ ] Write unit tests for `modelScanner.ts` (mock fetch responses)

---

### Story E8.3 — Models page UI

**As a pipeline TD or admin, I can browse all indexed models grouped by type.**

- [ ] Create `apps/web/src/app/(main)/models/page.tsx`:
  - `useQuery(['models'], () => fetch('/api/models').then(r => r.json()))`
  - Group models by `type` with section headers: Checkpoints, LoRAs, VAEs, ControlNets, Upscalers, Other
  - Per model card: filename, type badge, `comfyPort` indicator, `sizeBytes` formatted
  - Search input filtering by filename (client-side)
  - "Rescan" button → `POST /api/models/scan` for each active ComfyUI port (fetched from `/api/comfy/scan`)
- [ ] Create `GET /api/models` route: `SELECT * FROM models ORDER BY type, filename`
- [ ] Add `/models` to sidebar nav in `_Sidebar.tsx` and to `ROLE_NAV` in `auth.ts` for `admin`, `pipeline_td`, `dev`

---

## Cross-Cutting Tasks

### Auth & routing

- [ ] Add `pipeline_td` to `ROLE_NAV[pipeline_td]` in `auth.ts` if not present; ensure it includes `/explore`, `/models`, `/settings`
- [ ] Add `/explore` to `artist` role in `ROLE_NAV` (artists should browse + install apps)
- [ ] All new API routes: call `getSessionUser(req)` and return 401 if null (follow existing pattern)
- [ ] All bridge routes: additionally verify `appId` matches an active `installed_apps` row

### TypeScript

- [ ] Run `pnpm --filter @flowscale/eios-web typecheck` after each epic; fix all errors before considering done
- [ ] Run `pnpm --filter @flowscale/sdk build` after each SDK story; zero type errors

### Testing

- [ ] Unit: `appManifest.test.ts` — valid + invalid manifests
- [ ] Unit: `bridgeServer.test.ts` — permission allow, permission deny, unknown method
- [ ] Unit: `modelScanner.test.ts` — mock ComfyUI `/models/*` responses
- [ ] Unit: `modelChecker.test.ts` — available + missing models
- [ ] Integration: `POST /api/apps/sideload` — valid path, missing manifest, invalid manifest
- [ ] Integration: `POST /api/bridge/storage` — get/set/delete/list roundtrip
- [ ] Integration: `POST /api/bridge/storage/files/write` + `GET .../read` roundtrip
- [ ] Integration: `POST /api/apps/install` — missing deps response, forced install

---

## Implementation Order

```
E1 (SDK types + bridge client)          — no dependencies
E2.1–2.2 (registry tool schemas)        — no dependencies; parallelise with E1
  └─ E2.3–2.4 (model checking + exec)  — needs E2.1
E3 (providers)                          — no dependencies; parallelise with E1/E2
E4.1 (DB tables)                        — no dependencies
  └─ E4.2 (manifest validation)
    └─ E4.3 (bundle serving)
      └─ E4.4–4.5 (AppFrame + bridge)  — needs E1, E2.4, E3
        └─ E4.6 (bridge API routes)
          └─ E4.7 (main-app slot)
E5 (file storage)                       — needs E4.1
E6.1–6.2 (sideloading + hot reload)     — needs E4.2, E4.3
  └─ E6.3 (CLI)                         — needs E1
E8.1–8.2 (models DB + scan)             — needs E4.1
  └─ E8.3 (models page)
    └─ E7 (registry + install + explore) — needs E8.2, E4 complete
```
