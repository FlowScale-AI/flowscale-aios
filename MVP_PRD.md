# FlowScale AIOS — MVP Product Reference

> **Last updated:** 2026-03-26
> This document describes the current state of FlowScale AIOS — what's live, the happy paths, and how features connect.

---

## What is FlowScale AIOS?

FlowScale AIOS is a desktop + web application for building, running, and managing AI tools. It wraps ComfyUI workflows and HuggingFace model plugins into simple tool interfaces, manages multi-GPU compute (local and cloud), and provides an app ecosystem where developers build sandboxed applications on top of those tools.

**Runs as:** Next.js 15 web app (port 14173) or Electron desktop shell.

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Tool** | A single AI endpoint. Two engines: *ComfyUI-engine* (workflow-based) or *API-engine* (plugin-driven with HuggingFace models). |
| **Plugin** | A tool plugin in `~/.flowscale/tool-plugins/{id}/` containing `manifest.json` + `server.py`. Powers API-engine tools. |
| **App** | An HTML bundle running in a sandboxed iframe, communicating with AIOS via JSON-RPC bridge. Lives in `~/.flowscale/apps/{id}/`. |
| **Canvas** | A visual board where tools, outputs, and items can be arranged spatially. |
| **Execution** | A single run of a tool with inputs, producing outputs. Tracked in the DB with status/duration/outputs. |

---

## Happy Flows

### 1. First-Time Setup

1. Launch AIOS (desktop app or `pnpm dev`).
2. Redirected to login page. On first run, an admin password is auto-generated and displayed.
3. Log in as `admin`.
4. Go to **Settings > General** to configure ComfyUI path (auto-detects macOS `.app` bundles).
5. AIOS validates the path and detects GPU hardware.
6. Go to **Settings > Compute** to see detected GPUs and start ComfyUI instances (one per GPU + CPU).
7. ComfyUI instances launch on ports 41188+ with device isolation (`CUDA_VISIBLE_DEVICES`).

### 2. Build a ComfyUI Tool (Build Tool Wizard)

1. From **Tools** page, click **Build Tool**.
2. **Step 1 — Attach:** Pick a workflow from ComfyUI's saved workflows grid.
3. **Step 2 — Configure:** AIOS auto-analyzes the workflow, extracts inputs/outputs, generates a schema. User names the tool, adjusts input visibility, selects ComfyUI instance.
4. **Step 3 — Test:** Run the tool against a live ComfyUI instance. WebSocket-driven progress bar. Outputs display inline (images, video, audio, 3D models). **Compute dropdown** lets you pick Local (auto-route or specific instance) or Cloud (Modal ComfyUI).
5. **Step 4 — Deploy:** Flip tool status to `production`. Tool appears in the Tools dashboard.

### 3. Install an API-Engine Tool (Plugin)

1. From **Tools** page, switch to **Available Tools** tab.
2. Browse registry plugins fetched from `flowscale.ai/tools/registry.json` (cached 5 min).
3. Click **Install** on a plugin (e.g., `z-image-turbo`).
4. Plugin downloads to `~/.flowscale/tool-plugins/{id}/`, manifest is read, tool record created in DB.
5. Tool appears in **My Tools** with an API-engine badge.
6. Can also **Import** custom plugins from a local path or GitHub URL.

### 4. Run a Tool

1. Open any tool from **Tools** page.
2. Fill in inputs (text prompts, images, sliders, dropdowns — rendered from schema).
3. Select compute target from the **Compute** dropdown:
   - `Local · Auto-route` — round-robin across running local instances
   - `Local · [instance name]` — pin to a specific GPU/CPU instance
   - `Cloud · Auto-route` — round-robin across deployed Modal instances
   - `Cloud · [deployment name] (GPU)` — pin to a specific cloud deployment
4. Selection is **persisted per tool** in localStorage.
5. Click **Run**. Progress bar shows real-time status via WebSocket (ComfyUI) or polling (API-engine).
6. Outputs render inline: images with blur-reveal, video/audio with native players, 3D with model-viewer.
7. Execution recorded in DB. Outputs saved to `~/.flowscale/aios-outputs/`.

### 5. Deploy a Tool to Modal Cloud

**API-engine tools:**
1. Open the tool page. The **Modal Deploy Banner** appears if the plugin supports Modal.
2. Click **+ Deploy**. Enter a deployment name, select GPU tier (T4 through B200).
3. AIOS validates Modal secrets (for gated HuggingFace models), then fires off deployment via `modal-helper.py`.
4. Banner shows deploying status with spinner. On completion, deployment appears with warm/cold indicator.
5. Select the cloud deployment in the **Compute** dropdown to route executions there.

**ComfyUI instances:**
1. Go to **Settings > Compute** or the ComfyUI integration page.
2. Modal ComfyUI section shows deployable instances.
3. Deploy a ComfyUI instance to Modal with GPU selection.
4. Virtual port (50000–50999) maps cloud instance into the local port space.
5. Cloud instances appear in the **Compute** dropdown on all ComfyUI-engine tools.

### 6. Browse Jobs & Assets

**Jobs:**
1. Navigate to **Jobs** from sidebar.
2. Three tabs: **Active** (running), **Completed**, **Failed**.
3. Search by prompt text. Each row shows status, duration, timestamp.
4. Click a job to see full detail page with outputs and metadata.

**Assets:**
1. Navigate to **Assets** from sidebar.
2. Select a tool from the dropdown to filter.
3. Gallery view of all outputs across executions.
4. Click any asset for lightbox view. Download button available.
5. Supports images, video, audio, 3D models (GLB/GLTF).

### 7. Use an App

1. Navigate to the apps grid (accessible from sidebar or home quick actions).
2. Browse installed apps (registry or sideloaded). Search by name.
3. Click an app to open it in a sandboxed iframe.
4. App communicates with AIOS via JSON-RPC 2.0 bridge:
   - `tools.list/get/run` — discover and execute tools (requires `tools` permission)
   - `providers.list/run` — call cloud providers without seeing API keys
   - `storage.get/set/delete/keys` — per-app key-value persistence
   - `storage.files.read/write/delete/list` — per-app file storage
   - `ui.toast/confirm` — trigger host notifications and dialogs
5. Menu button offers: Reload, View Permissions, About, Uninstall.

### 8. Build an App (Developer Flow)

1. Run `npx create-flowscale-aios-app` to scaffold a new app.
2. App includes `flowscale.app.json` manifest declaring permissions, entry point, capabilities.
3. Import `@flowscale/sdk` — provides typed API: `tools.run()`, `providers.run()`, `storage.*`, `ui.*`.
4. Build the app (outputs an HTML bundle).
5. Sideload into AIOS via **Settings > Developer** or `POST /api/apps/sideload`.
6. App appears in the grid with a "Dev" badge. Hot reload by rebuilding and refreshing.

### 9. Canvas Workflow

1. Navigate to **Canvas** from sidebar.
2. Create a new canvas board.
3. Open the canvas editor — drag tools, images, and items onto the spatial board.
4. Execute tools directly from the canvas via the floating control bar.
5. Arrange outputs visually for comparison or presentation.

### 10. Multi-User Setup

1. Admin creates users from **Settings > Users** or users self-register (pending approval).
2. Admin approves pending users and assigns roles:
   - **admin** — full access, user management, settings
   - **pipeline_td** — tools, settings, but not user management
   - **dev** — tools, apps, sideloading
   - **artist** — run tools only, simplified UI (no compute picker, no build wizard)
3. Each role sees only relevant sidebar items and features.

---

## Settings Breakdown

| Tab | What's There |
|-----|-------------|
| **General** | ComfyUI path setup, install type, Comfy.org API key |
| **Compute** | GPU/CPU detection, ComfyUI instance management (start/stop/restart per device), Modal login, cloud deployments overview |
| **Users** | Active users list, pending approvals, role management, add/delete users, change password |
| **Storage** | Database info, storage paths |
| **ComfyUI** | ComfyUI integration overview, models browser, custom nodes, instance logs, Modal ComfyUI section |
| **Providers** | API keys for fal.ai, Replicate, OpenRouter, HuggingFace (masked display, per-provider config) |

---

## Compute Architecture

```
                     Compute Dropdown
                           |
           ┌───────────────┴───────────────┐
           v                               v
     Local Instances                  Cloud (Modal)
           |                               |
    ┌──────┴──────┐                ┌───────┴───────┐
    v             v                v               v
  Auto-route   Specific       Auto-route      Specific
  (round-robin) Instance     (round-robin)   Deployment
    |             |                |               |
    v             v                v               v
  Port 41188+  Port N          VPort 50000+    VPort N
    |             |                |               |
    └──────┬──────┘                └───────┬───────┘
           v                               v
    Local ComfyUI                   Modal ComfyUI
    or server.py                    or modal_app.py
```

- **Local auto-route**: Server picks least-busy instance across all running ComfyUI processes.
- **Cloud auto-route**: Round-robin across deployed Modal instances.
- **Selection persisted per tool** in `localStorage` (`flowscale-tool-compute-{toolId}`).

---

## Tool Engines

### ComfyUI-Engine
- Built from ComfyUI workflows via Build Tool wizard.
- Executed by queuing prompts to a running ComfyUI instance.
- Supports workflow analysis, custom node introspection, and graph-to-API normalization.
- Outputs downloaded from ComfyUI and saved to disk post-completion.

### API-Engine (Plugin-Driven)
- Backed by plugins: `manifest.json` (schema, port, GPU config) + `server.py` (HuggingFace inference).
- Plugin lifecycle: install from registry or import custom, start/stop inference server, health checks.
- Can be deployed to Modal for cloud GPU execution.
- Local inference managed by `localInference.ts` with `child_process.spawn()`.

---

## Modal Cloud Integration

| Component | Purpose |
|-----------|---------|
| `modal-manager.ts` | CLI install, auth, binary resolution (`findModalBin`) |
| `modal-deploy.ts` | Deploy/undeploy API-engine plugins, persistent state in `modal-deployments.json` |
| `modal-comfyui.ts` | Cloud ComfyUI instances with virtual port mapping |
| `modal-helper.py` | Python bridge to Modal SDK (deploy, undeploy, logs, status) |

**GPU tiers:** T4, L4, A10, L40S, A100-40GB, A100-80GB, RTX-PRO-6000, H100, H200, B200

**Deployment states:** `deploying` → `deployed` | `failed`

**Health checks** only run when user actively views the Logs tab to avoid cold-starting containers and burning GPU credits.

---

## App Ecosystem

### Bridge Protocol
Apps in sandboxed iframes (`allow-scripts allow-same-origin`) communicate via **JSON-RPC 2.0 over `postMessage`**.

| Method | Permission | Description |
|--------|-----------|-------------|
| `app.ready` | none | Signal iframe loaded |
| `tools.list/get/run` | `tools` | Discover and execute tools |
| `providers.list/run` | `providers:[name]` | Call cloud providers |
| `storage.get/set/delete/keys` | `storage:readwrite` | Per-app KV storage |
| `storage.files.read/write/delete/list` | `storage:files` | Per-app file storage |
| `ui.toast/confirm` | none | Host notifications and dialogs |

### SDK (`@flowscale/sdk`)
TypeScript SDK for app developers. Namespaced API: `tools.*`, `providers.*`, `storage.*`, `ui.*`, `app.*`, `instances.*`, `http.*`.

### App Manifest (`flowscale.app.json`)
```json
{
  "name": "my-app",
  "displayName": "My App",
  "version": "1.0.0",
  "sdk": "1.0.0",
  "entry": "index.html",
  "permissions": ["tools", "storage:readwrite"],
  "capabilities": { "slots": ["main-app"] }
}
```

---

## Data Storage

| What | Where |
|------|-------|
| Database | `~/.flowscale/aios.db` (SQLite via Drizzle ORM) |
| Settings | `~/.flowscale/aios/settings.json` |
| Provider keys | `~/.flowscale/aios/provider-keys.json` |
| Tool outputs | `~/.flowscale/aios-outputs/[toolId]/[execId_filename]` |
| Tool plugins | `~/.flowscale/tool-plugins/{id}/` |
| Apps | `~/.flowscale/apps/{id}/` |
| Modal state | `~/.flowscale/aios/modal-deployments.json` |
| ComfyUI PIDs | `~/.flowscale/aios/comfyui-{instanceId}.pid` |
| Plugin logs | `~/.flowscale/aios/plugin-{id}.log` |
| Registry cache | `~/.flowscale/aios/registry-cache.json` (5-min TTL) |

---

## Desktop Shell (Electron)

- Loads Next.js standalone server from `process.resourcesPath`.
- Auto-finds available port starting from 14173.
- Single-instance lock prevents multiple windows.
- Native IPC bridges: file dialogs, shell.openExternal, file watching, PKCE OAuth, auto-updates.
- Platform-specific builds: macOS DMG, Linux AppImage, Windows NSIS.
- Logs: `~/Library/Logs/flowscale-aios/main.log` (macOS), `~/.config/flowscale-aios/logs/main.log` (Linux).

---

## Ports

| Port | Purpose |
|------|---------|
| 14173 | AIOS web app |
| 41188–41200 | AIOS-managed ComfyUI instances |
| 50000–50999 | Virtual ports for Modal cloud ComfyUI |
| 8000, 8188 | Well-known external ComfyUI (auto-detected on scan) |

---

## Coming Soon

- Flux LoRA Trainer plugin
- SDXL LoRA Trainer plugin
- Direct HuggingFace, OpenAI, Replicate, fal.ai integration pages (provider key storage works; dedicated UIs are placeholders)
