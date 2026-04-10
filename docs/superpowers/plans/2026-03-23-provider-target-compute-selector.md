# Provider/Target Two-Dropdown Compute Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single device selector with a two-dropdown provider/target system supporting multiple named Modal deployments per tool.

**Architecture:** Two `<select>` dropdowns (Provider: Local/Modal; Target: devices or deployments). Data model changes from single deployment per plugin to array of `ModalDeploymentRecord`. Deploy popup creates named instances. Round-robin auto-routing within each provider.

**Tech Stack:** Next.js 15 API routes, React hooks, Modal Python SDK, child_process

**Spec:** `docs/superpowers/specs/2026-03-23-provider-target-compute-selector-design.md`

---

## File Structure

### Modified files
| File | Change |
|------|--------|
| `apps/web/src/lib/modal-deploy.ts` | Array-based deployments, migration, auto-routing, new function signatures |
| `apps/web/scripts/modal-helper.py` | Accept `app-name` CLI arg, pass `FLOWSCALE_APP_NAME` env var |
| `apps/web/src/app/api/modal/deploy/[pluginId]/route.ts` | Return deployments array, selective health checks, deploy/undeploy by ID |
| `apps/web/src/hooks/useModalDeployStatus.ts` | New return type with deployments array |
| `apps/web/src/components/ModalDeployBanner.tsx` | List deployments, deploy popup with name/GPU form |
| `apps/web/src/app/(main)/apps/[id]/page.tsx` | Two dropdowns, state refactor, updated execution body |
| `apps/web/src/app/api/tools/[id]/executions/route.ts` | Accept `provider`/`modalDeployId`, auto-routing |
| `~/.flowscale/tool-plugins/z-image-turbo/modal_app.py` | Read `FLOWSCALE_APP_NAME` env var |

---

## Task 1: Update data model in `modal-deploy.ts`

**Files:**
- Modify: `apps/web/src/lib/modal-deploy.ts`

- [ ] **Step 1: Update types and migration**

Replace the `ModalDeployment` interface and `DeploymentsFile` type, add migration logic. The new types:

```ts
export interface ModalDeploymentRecord {
  id: string
  name: string
  status: 'deploying' | 'deployed'
  appName: string
  url: string
  gpu: string
  deployedAt: number
}

type DeploymentsFile = Record<string, ModalDeploymentRecord[]>
```

Replace `readDeployments()` to handle migration from the old single-object format to the new array format. If an entry is an object (not array), derive `id`/`name` from `appName` by stripping `flowscale-` prefix, wrap in array, and write back immediately.

- [ ] **Step 2: Update `setDeployment` to array operations**

Replace `setDeployment(pluginId, record | null)` with:

```ts
function addDeployment(pluginId: string, record: ModalDeploymentRecord): void
function updateDeployment(pluginId: string, deployId: string, updates: Partial<ModalDeploymentRecord>): void
function removeDeployment(pluginId: string, deployId: string): void
```

- [ ] **Step 3: Update `deployToModal` signature**

Change from `deployToModal(pluginId, gpu)` to:
```ts
export async function deployToModal(
  pluginId: string, gpu: string, deployId: string, name: string
): Promise<{ success: boolean; appName?: string; url?: string; error?: string }>
```

It should:
- Check name uniqueness against existing deployments
- Set `appName = 'flowscale-' + deployId`
- Call `runHelper(['deploy', pluginDir, gpu, appName])` (new CLI arg)
- Write the record with `addDeployment`

- [ ] **Step 4: Update `undeployFromModal` to accept deployId**

Change from `undeployFromModal(pluginId)` to:
```ts
export async function undeployFromModal(pluginId: string, deployId: string): Promise<{ success: boolean; error?: string }>
```

Looks up the specific deployment's `appName`, calls undeploy helper, then `removeDeployment`.

- [ ] **Step 5: Update `getModalDeployStatus` to return array**

Replace with:
```ts
export function getDeployments(pluginId: string): ModalDeploymentRecord[]
export function getDeploymentById(pluginId: string, deployId: string): ModalDeploymentRecord | null
```

Remove the old `getModalDeployStatus` that spawns a subprocess. Status checking (warm/cold) moves to the API route.

- [ ] **Step 6: Add auto-routing**

```ts
const _modalRouteCounters = new Map<string, number>()

export function autoRouteModalDeployment(pluginId: string): ModalDeploymentRecord | null {
  const deployed = getDeployments(pluginId).filter(d => d.status === 'deployed')
  if (deployed.length === 0) return null
  const counter = (_modalRouteCounters.get(pluginId) ?? 0) % deployed.length
  _modalRouteCounters.set(pluginId, counter + 1)
  return deployed[counter]
}
```

- [ ] **Step 7: Update `getModalUrl` → `getModalDeployUrl`**

```ts
export function getModalDeployUrl(pluginId: string, deployId: string): string | null {
  const record = getDeploymentById(pluginId, deployId)
  return record?.status === 'deployed' ? record.url : null
}
```

- [ ] **Step 8: Update concurrent deploy guard**

Change `_deployingPlugins` from `Set<string>` to check the deployments array: `isDeploying(pluginId)` returns true if any deployment for the plugin has `status === 'deploying'`.

- [ ] **Step 9: Update log file writing**

When `deployToModal` writes the "deploying" log entry, write to both `modal-{deployId}.log` and `modal-latest.log` in the plugin dir. Pass the `deployId` to `runHelper` so the helper can name the log file accordingly. Update `getModalLogs` to accept an optional `deployId` and read from `modal-{deployId}.log` if provided, falling back to `modal-latest.log`.

- [ ] **Step 10: Remove old `getModalUrl` export**

Delete the old `getModalUrl` function entirely. It's replaced by `getModalDeployUrl`. The only consumer (execution route) is updated in Task 5.

- [ ] **Step 11: Run typecheck**

Run: `pnpm typecheck`
Expected: Will fail (API route and page still reference old functions) — that's OK, we fix those in later tasks.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/lib/modal-deploy.ts
git commit -m "feat: array-based Modal deployments with migration and auto-routing"
```

---

## Task 2: Update `modal-helper.py` to accept app name

**Files:**
- Modify: `apps/web/scripts/modal-helper.py`

- [ ] **Step 1: Update `cmd_deploy` to accept and use `app_name` parameter**

Add `app_name` as a fourth parameter to `cmd_deploy(plugin_dir, gpu, app_name)`.

Pass it as env var to the subprocess:
```python
env = {**os.environ, "FLOWSCALE_GPU": gpu, "FLOWSCALE_APP_NAME": app_name}
```

Use the provided `app_name` in the JSON output instead of deriving from manifest:
```python
_json_out({"success": True, "appName": app_name, "url": url or "", "gpu": gpu})
```

- [ ] **Step 2: Update the CLI dispatch**

Change the deploy dispatch from `len(sys.argv) >= 4` to `len(sys.argv) >= 5`:
```python
if command == "deploy" and len(sys.argv) >= 5:
    cmd_deploy(sys.argv[2], sys.argv[3], sys.argv[4])
```

- [ ] **Step 3: Test manually**

Run: `python3 apps/web/scripts/modal-helper.py deploy ~/.flowscale/tool-plugins/z-image-turbo A10G flowscale-test-deploy`
Expected: JSON output (will fail to actually deploy but should pass arg parsing)

- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/modal-helper.py
git commit -m "feat: modal-helper accepts app-name CLI arg for multi-deployment"
```

---

## Task 3: Update `modal_app.py` to read `FLOWSCALE_APP_NAME`

**Files:**
- Modify: `~/.flowscale/tool-plugins/z-image-turbo/modal_app.py`

- [ ] **Step 1: Update app name line**

Change:
```python
app = modal.App(f"flowscale-{_manifest.get('id', 'unknown')}")
```
To:
```python
_app_name = os.environ.get("FLOWSCALE_APP_NAME", f"flowscale-{_manifest.get('id', 'unknown')}")
app = modal.App(_app_name)
```

- [ ] **Step 2: Verify syntax**

Run: `python3 -c "import ast; ast.parse(open('$HOME/.flowscale/tool-plugins/z-image-turbo/modal_app.py').read()); print('OK')"`

---

## Task 4: Update the deploy API route

**Files:**
- Modify: `apps/web/src/app/api/modal/deploy/[pluginId]/route.ts`

- [ ] **Step 1: Rewrite GET handler**

Return `{ supported, defaultGpu, deployments: [...], logs }`. Each deployment includes `warm: boolean | null`. Only health-check the deployment specified by `?target=` query param (skip health checks for others, return `warm: null`).

```ts
export async function GET(req, { params }) {
  // ... auth check ...
  const { pluginId } = await params
  const plugin = getPlugin(pluginId)
  const modalSupported = plugin?.cloud?.modal?.supported === true
    && existsSync(join(homedir(), '.flowscale', 'tool-plugins', pluginId, 'modal_app.py'))

  const deployments = getDeployments(pluginId)
  const targetId = req.nextUrl.searchParams.get('target')
  const includeLogs = req.nextUrl.searchParams.get('logs') !== 'false'

  // Build response with selective warm/cold checks
  const deploymentsWithStatus = await Promise.all(
    deployments.map(async (d) => {
      let warm: boolean | null = null
      if (targetId === d.id && d.status === 'deployed' && d.url) {
        // Health check only the selected target
        warm = await checkHealth(d.url)
      }
      return { ...d, warm }
    })
  )

  const logs = includeLogs ? await getModalLogs(pluginId) : ''

  return NextResponse.json({
    supported: modalSupported,
    defaultGpu: plugin?.cloud?.modal?.defaultGpu ?? 'A10G',
    deployments: deploymentsWithStatus,
    logs,
  })
}
```

Add a `checkHealth` helper (extracted from the Python helper logic):
```ts
async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch { return false }
}
```

- [ ] **Step 2: Rewrite POST handler**

Accept `name` in deploy action, `deployId` in undeploy:

```ts
if (action === 'deploy') {
  const { name } = body
  // Validate name format: alphanumeric + hyphens, max 64 chars
  if (!name || !/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(name)) {
    return NextResponse.json({ error: 'Invalid name: alphanumeric + hyphens, 2-64 chars' }, { status: 400 })
  }
  // Validate gpu, name uniqueness, check no deploying instances
  const existing = getDeployments(pluginId)
  if (existing.some(d => d.id === name || d.name === name)) {
    return NextResponse.json({ error: 'Deployment name already exists' }, { status: 409 })
  }
  if (existing.some(d => d.status === 'deploying')) {
    return NextResponse.json({ error: 'Another deployment is in progress' }, { status: 409 })
  }
  // deployId = name at creation time (they start identical, name is for display)
  deployToModal(pluginId, gpu, name, name).catch(...)
  return NextResponse.json({ status: 'deploying', deployId: name, gpu }, { status: 202 })
}

if (action === 'undeploy') {
  const { deployId } = body
  const target = getDeploymentById(pluginId, deployId)
  if (!target) return NextResponse.json({ error: 'Deployment not found' }, { status: 404 })
  if (target.status === 'deploying') return NextResponse.json({ error: 'Cannot undeploy while deploying' }, { status: 400 })
  await undeployFromModal(pluginId, deployId)
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/modal/deploy/
git commit -m "feat: deploy API supports multiple deployments with selective health checks"
```

---

## Task 5: Update the execution route

**Files:**
- Modify: `apps/web/src/app/api/tools/[id]/executions/route.ts`

- [ ] **Step 1: Update imports**

Replace `import { getModalUrl } from '@/lib/modal-deploy'` with:
```ts
import { getModalDeployUrl, autoRouteModalDeployment, getDeploymentById } from '@/lib/modal-deploy'
```

- [ ] **Step 2: Update the Modal execution branch**

The current branch checks `comfyPortOverride === 'modal'`. Update to also accept the new format:

```ts
// Support both old format (comfyPort: 'modal') and new (provider: 'modal', modalDeployId: '...')
const provider = body.provider as string | undefined
const modalDeployId = body.modalDeployId as string | undefined
const isModal = provider === 'modal' || comfyPortOverride === 'modal'

if (isModal) {
  const config = JSON.parse(tool.workflowJson) as { pluginId: string }
  const plugin = getPlugin(config.pluginId)
  if (!plugin) return NextResponse.json({ error: `Unknown plugin` }, { status: 400 })

  // Resolve deployment URL
  let modalUrl: string | null = null
  let resolvedDeployId = modalDeployId ?? 'auto'

  if (resolvedDeployId === 'auto') {
    const deployment = autoRouteModalDeployment(config.pluginId)
    if (!deployment) return NextResponse.json({ error: 'No Modal deployments available' }, { status: 400 })
    modalUrl = deployment.url
  } else {
    modalUrl = getModalDeployUrl(config.pluginId, resolvedDeployId)
  }

  if (!modalUrl) return NextResponse.json({ error: 'Modal deployment not found or not ready' }, { status: 400 })

  // ... rest of execution (create row, runModalInference) unchanged ...
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

- [ ] **Step 4: Test backward compatibility**

```bash
SESSION=$(sqlite3 ~/.flowscale/aios.db "SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1")
# Old format (should still work)
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"inputs":{},"comfyPort":"modal"}' \
  -b "fs_session=$SESSION" \
  http://localhost:14173/api/tools/z-image-turbo-builtin/executions | python3 -m json.tool
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/tools/\[id\]/executions/route.ts
git commit -m "feat: execution route supports multi-deployment Modal with auto-routing"
```

---

## Task 6: Update the hook return type

**Files:**
- Modify: `apps/web/src/hooks/useModalDeployStatus.ts`

- [ ] **Step 1: Update types and queries**

```ts
export interface ModalDeploymentStatus {
  id: string
  name: string
  status: 'deploying' | 'deployed'
  gpu: string
  warm: boolean | null
  url: string
}

export interface ModalDeployStatusData {
  supported: boolean
  defaultGpu: string
  deployments: ModalDeploymentStatus[]
  logs?: string
}
```

Update `useModalDeployStatus` to pass `?target=` query param and fix refetchInterval:
```ts
export function useModalDeployStatus(pluginId: string | null, selectedTarget?: string) {
  // ...
  queryFn: async () => {
    const params = new URLSearchParams()
    params.set('logs', 'false')
    if (selectedTarget && selectedTarget !== '') params.set('target', selectedTarget)
    const res = await fetch(`/api/modal/deploy/${pluginId}?${params}`)
    // ...
  },
  refetchInterval: pluginId && visible ? (query) => {
    const deployments = query.state.data?.deployments ?? []
    // Poll faster when any deployment is in progress
    return deployments.some(d => d.status === 'deploying') ? 5_000 : 60_000
  } : false,
}
```

`useModalLogs` stays the same.

- [ ] **Step 2: Run typecheck** (will still fail until page.tsx is updated)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useModalDeployStatus.ts
git commit -m "feat: useModalDeployStatus returns deployments array with selective health"
```

---

## Task 7: Rewrite `ModalDeployBanner` with deployment list and deploy popup

**Files:**
- Modify: `apps/web/src/components/ModalDeployBanner.tsx`

- [ ] **Step 1: Rewrite the component**

The banner now receives the full deployments array and shows:
- A header row with deployment count and "+ Deploy" button
- A list of existing deployments (name, GPU badge, warm/cold dot, Undeploy button)
- A deploy popup (modal dialog) with name input + GPU selector

Props change:
```ts
interface ModalDeployBannerProps {
  pluginId: string
  defaultGpu: string
  deployments: ModalDeploymentStatus[]
  onDeployed?: () => void  // trigger refetch
}
```

The popup uses React state (`showDeployPopup`). Key logic:

**Auto-naming function:**
```ts
function generateDeployName(pluginId: string, gpu: string, existing: ModalDeploymentStatus[]): string {
  const prefix = `${pluginId}-${gpu.toLowerCase()}`
  let n = 1
  while (existing.some(d => d.id === `${prefix}-${n}` || d.name === `${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}
```

**Popup JSX:** A `<dialog>` or absolutely-positioned div with:
- Name input: `<input>` pre-filled with auto-generated name, client-side validation (`/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/`)
- GPU selector: `<select>` populated from `GPU_OPTIONS` constant (T4/A10G/L4/A100/H100)
- Cancel button: closes popup
- Deploy button: POSTs `{ action: 'deploy', gpu, name }`, disabled when `deployments.some(d => d.status === 'deploying')`
- Error display: shows mutation error inline

**Deployment list:** Maps over `deployments` array. Each row:
- Name + GPU badge + warm/cold dot + Undeploy button
- Undeploy button disabled when `status === 'deploying'`
- On undeploy click, POSTs `{ action: 'undeploy', deployId: d.id }`

- [ ] **Step 2: Run typecheck**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ModalDeployBanner.tsx
git commit -m "feat: ModalDeployBanner with multi-deployment list and deploy popup"
```

---

## Task 8: Update tool detail page with two dropdowns

**Files:**
- Modify: `apps/web/src/app/(main)/apps/[id]/page.tsx`

- [ ] **Step 1: Replace `selectedDevice` state with provider/target**

Replace:
```ts
const [selectedDevice, setSelectedDevice] = useState<string>('')
const isModalSelected = selectedDevice === 'modal'
```
With:
```ts
const [selectedProvider, setSelectedProvider] = useState<'local' | 'modal'>('local')
const [selectedTarget, setSelectedTarget] = useState<string>('')  // '' = Auto
const isModalSelected = selectedProvider === 'modal'
```

Update `effectiveDevice` to only apply when `selectedProvider === 'local'`:
```ts
const effectiveDevice = selectedProvider === 'local'
  ? (selectedTarget || gpuDevices.find((d) => !busyDevices.has(d.device))?.device ?? '')
  : ''
```

- [ ] **Step 2: Update `useModalDeployStatus` call**

Pass `selectedTarget` when Modal is selected:
```ts
const { data: modalDeployData } = useModalDeployStatus(pluginId, isModalSelected ? selectedTarget : undefined)
```

- [ ] **Step 3: Replace the single `<select>` with two dropdowns**

Replace the device selector block (lines ~1099-1120) with:

```tsx
{!isArtist && tool.engine === 'api' && (
  <>
    {/* Provider dropdown */}
    <select
      value={selectedProvider}
      onChange={(e) => { setSelectedProvider(e.target.value as 'local' | 'modal'); setSelectedTarget('') }}
      className="px-2 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-md text-zinc-300 focus:outline-none focus:border-zinc-600"
    >
      <option value="local">Local</option>
      {modalSupported && modalStatus?.authenticated && (
        <option value="modal">Modal</option>
      )}
    </select>
    {/* Target dropdown */}
    <select
      value={selectedTarget}
      onChange={(e) => setSelectedTarget(e.target.value)}
      className="px-2 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-md text-zinc-300 focus:outline-none focus:border-zinc-600"
    >
      <option value="">Auto</option>
      {selectedProvider === 'local' && gpuDevices.map((d) => {
        const busy = busyDevices.has(d.device)
        return (
          <option key={d.id} value={d.device} disabled={busy}>
            {d.label}{busy ? ' — in use' : ''}
          </option>
        )
      })}
      {selectedProvider === 'modal' && (modalDeployData?.deployments ?? [])
        .filter(d => d.status === 'deployed')
        .map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.gpu})
          </option>
        ))
      }
    </select>
  </>
)}
```

- [ ] **Step 4: Update the run mutation body**

Replace the Modal body logic:
```ts
body: JSON.stringify({
  inputs,
  comfyOrgApiKey: getComfyOrgApiKey() || undefined,
  ...(pinnedPort != null ? { comfyPort: pinnedPort } : {}),
  ...(selectedProvider === 'modal'
    ? { provider: 'modal', modalDeployId: selectedTarget || 'auto' }
    : effectiveDevice ? { device: effectiveDevice } : {}),
}),
```

- [ ] **Step 5: Update ModalDeployBanner props**

```tsx
{tool.engine === 'api' && isModalSelected && pluginId && modalSupported && (
  <ModalDeployBanner
    pluginId={pluginId}
    defaultGpu={modalDeployData?.defaultGpu ?? 'A10G'}
    deployments={modalDeployData?.deployments ?? []}
    onDeployed={() => qc.invalidateQueries({ queryKey: ['modal-deploy-status', pluginId] })}
  />
)}
```

- [ ] **Step 6: Update `modalLogs` pass-through to BottomTabs**

Keep using `modalLogsData?.logs` — no change needed.

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/\(main\)/apps/\[id\]/page.tsx
git commit -m "feat: two-dropdown provider/target compute selector for API tools"
```

---

## Task 9: End-to-end verification (Playwright + API)

- [ ] **Step 1: Navigate to Z-Image Turbo, verify two dropdowns**

Verify Provider dropdown shows "Local" and "Modal". Target dropdown shows Auto + GPU devices when Local is selected.

- [ ] **Step 2: Switch to Modal provider**

Verify target dropdown shows Auto + any existing deployments. Banner shows deployment list or "No Modal deployments".

- [ ] **Step 3: Click "+ Deploy", verify popup**

Verify popup shows name input (auto-generated) and GPU selector.

- [ ] **Step 4: Deploy a new instance**

Fill in name, select GPU, click Deploy. Verify banner updates to show the new deployment in "deploying" state.

- [ ] **Step 5: Verify deployed state**

After deploy completes, verify deployment shows in the target dropdown and banner shows warm/cold status.

- [ ] **Step 6: Run inference via the new deployment**

Select the specific deployment in target dropdown, click Run. Verify execution completes.

- [ ] **Step 7: Test Auto routing**

Select "Auto" in target dropdown, run inference. Verify it routes to a deployed instance.

- [ ] **Step 8: Test undeploy**

Click Undeploy on a deployment. Verify it's removed from the list and target dropdown.

- [ ] **Step 9: Verify ComfyUI tools unaffected**

Navigate to a ComfyUI tool. Verify it still uses the old ComputePicker, no provider/target dropdowns.

- [ ] **Step 10: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 11: Final commit**

Note: `comfyPort: 'modal'` backward compat is maintained in the execution route for external callers (bridge `tools.run`, SDK). The page.tsx now sends `{ provider: 'modal', modalDeployId }` but old callers still work via the fallback.

```bash
git commit --allow-empty -m "test: verify provider/target compute selector E2E"
```
