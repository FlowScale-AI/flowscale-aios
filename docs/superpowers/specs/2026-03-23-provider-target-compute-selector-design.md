# Provider/Target Two-Dropdown Compute Selector

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Replace the single device selector with a two-dropdown provider/target system supporting multiple Modal deployments per tool.

---

## Overview

The current single `<select>` dropdown for API-engine tools mixes local devices and cloud compute in one flat list. This design splits it into two dropdowns: **Provider** (Local, Modal, future providers) and **Target** (devices or deployments within that provider). Each tool can have multiple Modal deployments (different GPUs, multiple instances of the same GPU), and "Auto" within a provider routes across its targets.

## 1. UI: Two Dropdowns in Toolbar

**Layout:**
```
[Provider ▾]  [Target ▾]  [▶ Run]
```

**Provider dropdown options:**
- `Local` — local machine inference
- `Modal` — Modal cloud (only shown when `cloud.modal.supported` and Modal authenticated)
- Future: `RunPod`, `AWS`, etc.

**Target dropdown (dynamic based on provider):**

When Provider = **Local**:
- `Auto` — round-robin across available local devices
- `GPU 0 — Radeon RX 7700 XT`
- `GPU 1 — Raphael`
- `CPU`

When Provider = **Modal**:
- `Auto` — round-robin across all deployed instances
- `z-image-turbo-a10g-1` (A10G)
- `z-image-turbo-a10g-2` (A10G)
- `z-image-turbo-h100-1` (H100)

**State:** Two state variables replace the current `selectedDevice`:
```ts
const [selectedProvider, setSelectedProvider] = useState<'local' | 'modal'>('local')
const [selectedTarget, setSelectedTarget] = useState<string>('')  // '' = Auto
```

`isModalSelected` becomes `selectedProvider === 'modal'`.

## 2. Deploy Popup

When Modal is the selected provider, the ModalDeployBanner shows existing deployments and a "Deploy" button. Clicking "Deploy" opens a centered modal/popup:

```
┌─ New Modal Deployment ────────────────────┐
│                                           │
│  Name:  [ z-image-turbo-a10g-1 ]          │
│  GPU:   [ A10G ▾ ]                        │
│                                           │
│              [Cancel]  [Deploy]            │
└───────────────────────────────────────────┘
```

**Auto-naming:** `{pluginId}-{gpu lowercase}-{n}` where `n` is the next available number for that GPU tier. Example: if `z-image-turbo-a10g-1` exists, next auto-name is `z-image-turbo-a10g-2`.

**User can edit** the name before deploying. Names are validated both client-side and server-side: alphanumeric + hyphens only, max 64 chars, unique within the plugin's deployments array.

**One deployment at a time per plugin.** The popup creates a single Modal app. If a deployment is already in `'deploying'` state for this plugin, the Deploy button is disabled. To add more, wait for the current deploy to finish and click "Deploy" again.

**Undeploy of a `'deploying'` instance** is prevented — the Undeploy button is disabled while `status === 'deploying'`.

## 3. Data Model

### `modal-deployments.json`

Changes from one record per plugin to an **array** of deployments per plugin:

```json
{
  "z-image-turbo": [
    {
      "id": "z-image-turbo-a10g-1",
      "name": "z-image-turbo-a10g-1",
      "status": "deployed",
      "appName": "flowscale-z-image-turbo-a10g-1",
      "url": "https://rupayanism--flowscale-z-image-turbo-a10g-1-inference-serve.modal.run",
      "gpu": "A10G",
      "deployedAt": 1742737000000
    },
    {
      "id": "z-image-turbo-h100-1",
      "name": "z-image-turbo-h100-1",
      "status": "deployed",
      "appName": "flowscale-z-image-turbo-h100-1",
      "url": "https://rupayanism--flowscale-z-image-turbo-h100-1-inference-serve.modal.run",
      "gpu": "H100",
      "deployedAt": 1742738000000
    }
  ]
}
```

**Fields per deployment:**
- `id` — unique identifier, immutable after creation, used as key for lookups
- `name` — display name, initially same as `id`, user-editable at creation (future: renameable via API)
- `status` — `'deploying' | 'deployed'`
- `appName` — Modal app name (`flowscale-{id}`)
- `url` — Modal endpoint URL (captured from deploy output)
- `gpu` — GPU tier string
- `deployedAt` — epoch ms

**Failed deploys:** If a deploy fails, the record is **removed** from the array (same as current behavior). The error is surfaced via the API response and deploy logs. No `'failed'` state — keeps the model simple.

### TypeScript types

```ts
interface ModalDeploymentRecord {
  id: string
  name: string
  status: 'deploying' | 'deployed'
  appName: string
  url: string
  gpu: string
  deployedAt: number
}

// modal-deployments.json shape
type DeploymentsFile = Record<string, ModalDeploymentRecord[]>
```

### Migration

On first read, if an entry is a plain object (old `ModalDeployment` format) instead of an array:
1. Derive `id` and `name` from old `appName` by stripping the `flowscale-` prefix (e.g. `flowscale-z-image-turbo` → `z-image-turbo`)
2. Wrap in a single-element array
3. Write the migrated format back to disk immediately (so migration runs only once)

```ts
function migrateDeployments(data: Record<string, unknown>): DeploymentsFile {
  const migrated: DeploymentsFile = {}
  for (const [pluginId, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      migrated[pluginId] = value
    } else if (value && typeof value === 'object' && 'appName' in value) {
      const old = value as { status: string; appName: string; url: string; gpu: string; deployedAt: number }
      const id = old.appName.replace(/^flowscale-/, '')
      migrated[pluginId] = [{
        id,
        name: id,
        status: old.status as 'deploying' | 'deployed',
        appName: old.appName,
        url: old.url,
        gpu: old.gpu,
        deployedAt: old.deployedAt,
      }]
    }
  }
  return migrated
}
```

## 4. Modal Auto Routing

When target is "Auto" and provider is "Modal", the execution route picks a deployed instance via **round-robin**.

Implementation in `modal-deploy.ts`:
```ts
const _modalRouteCounters = new Map<string, number>()

export function autoRouteModalDeployment(pluginId: string): ModalDeploymentRecord | null {
  const deployments = getDeployments(pluginId).filter(d => d.status === 'deployed')
  if (deployments.length === 0) return null
  const counter = (_modalRouteCounters.get(pluginId) ?? 0) % deployments.length
  _modalRouteCounters.set(pluginId, counter + 1)
  return deployments[counter]
}
```

## 5. Execution Flow

The execution request body changes:

**Before:**
```json
{ "inputs": {...}, "comfyPort": "modal" }
```

**After:**
```json
{ "inputs": {...}, "provider": "modal", "modalDeployId": "z-image-turbo-a10g-1" }
```

Or for auto:
```json
{ "inputs": {...}, "provider": "modal", "modalDeployId": "auto" }
```

The execution route:
1. Checks `provider === 'modal'` (replaces `comfyPort === 'modal'`)
2. If `modalDeployId === 'auto'`, calls `autoRouteModalDeployment(pluginId)` → gets a specific deployment
3. Else calls `getDeploymentById(pluginId, modalDeployId)` → gets the specific deployment
4. If no deployment found → 400 error
5. POSTs to `{deployment.url}/generate` (same as before)

**Key functions in `modal-deploy.ts`:**
```ts
export function getDeployments(pluginId: string): ModalDeploymentRecord[]
export function getDeploymentById(pluginId: string, deployId: string): ModalDeploymentRecord | null
export function autoRouteModalDeployment(pluginId: string): ModalDeploymentRecord | null
export async function deployToModal(pluginId: string, gpu: string, deployId: string, name: string): Promise<{...}>
export async function undeployFromModal(pluginId: string, deployId: string): Promise<{...}>
```

**Backward compatibility:** `comfyPort: 'modal'` is treated as `provider: 'modal', modalDeployId: 'auto'` for any in-flight requests.

## 6. Banner Changes

When provider is Modal, the `ModalDeployBanner` shows:

**No deployments:**
```
┌─────────────────────────────────────────────────────┐
│  ☁  No Modal deployments              [+ Deploy]    │
└─────────────────────────────────────────────────────┘
```

**With deployments:**
```
┌─────────────────────────────────────────────────────┐
│  ☁  2 deployments                     [+ Deploy]    │
│                                                     │
│  z-image-turbo-a10g-1  A10G  ● Warm    [Undeploy]   │
│  z-image-turbo-h100-1  H100  ○ Cold    [Undeploy]   │
└─────────────────────────────────────────────────────┘
```

Each deployment row shows: name, GPU badge, warm/cold indicator, undeploy button (disabled when `status === 'deploying'`).

## 7. API Route Changes

### GET `/api/modal/deploy/[pluginId]`

Returns:
```json
{
  "supported": true,
  "defaultGpu": "A10G",
  "deployments": [
    { "id": "z-image-turbo-a10g-1", "name": "z-image-turbo-a10g-1", "status": "deployed", "gpu": "A10G", "warm": true, "url": "..." },
    { "id": "z-image-turbo-h100-1", "name": "z-image-turbo-h100-1", "status": "deployed", "gpu": "H100", "warm": false, "url": "..." }
  ],
  "logs": "..."
}
```

**Warm/cold status:** Only checked for the **currently selected target** deployment (passed as `?target=z-image-turbo-a10g-1` query param). If no `target` param or `target=auto`, skip all health checks (return `warm: null` for each deployment). This avoids N subprocess calls per poll.

### POST `/api/modal/deploy/[pluginId]`

Actions:
- `{ action: "deploy", gpu: "A10G", name: "z-image-turbo-a10g-1" }` — deploy new instance. Server validates name uniqueness. Returns 409 if any deployment for this plugin is in `'deploying'` state.
- `{ action: "undeploy", deployId: "z-image-turbo-a10g-1" }` — undeploy specific instance. Returns 400 if target is `'deploying'`.

### Hook return type

```ts
export interface ModalDeployStatusData {
  supported: boolean
  defaultGpu: string
  deployments: Array<{
    id: string
    name: string
    status: 'deploying' | 'deployed'
    gpu: string
    warm: boolean | null
    url: string
  }>
  logs?: string
}
```

## 8. Modal App Name

Each deployment gets a unique Modal app name: `flowscale-{deployId}` (e.g. `flowscale-z-image-turbo-a10g-1`).

The `modal_app.py` template reads the app name from `FLOWSCALE_APP_NAME`:

```python
_app_name = os.environ.get("FLOWSCALE_APP_NAME", f"flowscale-{_plugin_id}")
app = modal.App(_app_name)
```

**Helper changes (`modal-helper.py`):**

`cmd_deploy` passes `FLOWSCALE_APP_NAME` in addition to `FLOWSCALE_GPU`:
```python
env = {**os.environ, "FLOWSCALE_GPU": gpu, "FLOWSCALE_APP_NAME": app_name}
```

The `app_name` parameter is passed from `modal-deploy.ts` via CLI args:
```
python modal-helper.py deploy <plugin-dir> <gpu> <app-name>
```

The helper uses the provided `app_name` in its JSON output instead of deriving from manifest.

**`deployToModal` signature:**
```ts
export async function deployToModal(
  pluginId: string,
  gpu: string,
  deployId: string,
  name: string,
): Promise<{ success: boolean; appName?: string; url?: string; error?: string }>
```

It calls `runHelper(['deploy', pluginDir, gpu, appName])` where `appName = 'flowscale-' + deployId`.

## 9. Logs

Deploy logs are written per-deployment: `modal-{deployId}.log` in the plugin directory. The `modal-latest.log` file is also updated for backward compatibility.

Runtime logs from `modal app logs` are fetched for the currently selected deployment only (not all deployments). The helper accepts the specific app name.

## 10. File Changes

### Modified
| File | Change |
|------|--------|
| `apps/web/src/app/(main)/apps/[id]/page.tsx` | Two dropdowns (provider + target), deploy popup, state refactor |
| `apps/web/src/lib/modal-deploy.ts` | Array-based deployments, deploy/undeploy by ID, auto-routing counter, migration |
| `apps/web/src/app/api/modal/deploy/[pluginId]/route.ts` | Return deployments array, accept deploy ID in actions, selective health checks |
| `apps/web/src/app/api/tools/[id]/executions/route.ts` | Accept `provider`/`modalDeployId`, look up specific URL, auto round-robin |
| `apps/web/src/components/ModalDeployBanner.tsx` | List deployments, deploy popup with name/GPU form |
| `apps/web/src/hooks/useModalDeployStatus.ts` | New return type with deployments array |
| `apps/web/scripts/modal-helper.py` | Accept app name as CLI arg, pass as env var |
| `~/.flowscale/tool-plugins/z-image-turbo/modal_app.py` | Read `FLOWSCALE_APP_NAME` env var |

### Not changed
| File | Reason |
|------|--------|
| `ComputePicker.tsx` | Only used by ComfyUI-engine tools — API tools use the new two-dropdown UI |
| `toolPlugins.ts` | Manifest types unchanged |
