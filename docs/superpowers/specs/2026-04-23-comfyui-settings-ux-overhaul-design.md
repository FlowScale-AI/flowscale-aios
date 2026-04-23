# ComfyUI Settings UX Overhaul — Design Spec
**Date:** 2026-04-23  
**Status:** Approved for implementation

---

## Problem

The ComfyUI settings tab is a single large card that mixes first-time setup fields (installation path, python executable, data directory) with live instance management controls. New users see a confusing dump of fields with no guidance. Power users managing running instances have to scroll past irrelevant setup UI.

---

## Solution

Two distinct states driven by `comfyManage?.isSetup`:

1. **Blank Setup State** — wizard-style onboarding for first-time users
2. **Active Dashboard** — clean instance management with advanced config hidden behind a modal

---

## State 1: Blank Setup State (`isSetup === false`)

A centered, distraction-free setup card. No instance list, no advanced paths — just the three paths to get ComfyUI connected.

### Header
- Title: "Connect your ComfyUI Workspace"
- Subtitle: "Link your local ComfyUI installation to FlowScale AIOS to manage instances and orchestrate generative workflows."

### Setup Options (3 cards, pick one)

**Option A — ComfyUI Desktop App**
- Probes the well-known macOS path `/Applications/ComfyUI.app/Contents/Resources/ComfyUI` via `GET /api/comfy/setup/validate-path`. On Linux/Windows auto-detect will return not-found; a manual path input is shown as fallback in all cases.
- Shows detected path with a green check, or a path input pre-filled with the default path when not found.
- On confirm: calls `POST /api/settings/comfyui-setup` (`installType: 'desktop-app'`, `managedPath`, `desktopUserDataPath`), then streams `POST /api/comfy/setup/install` (with `targetPath` to skip clone when bundled ComfyUI is valid), then calls `POST /api/comfy/setup/copy-assets` to import models/custom nodes from the Desktop App's data dir.
- CTA: "Use Desktop App"

**Option B — Install via FlowScale AIOS**
- Clones ComfyUI from GitHub into `~/.flowscale/comfyui` and runs pip install.
- On confirm: calls `POST /api/settings/comfyui-setup` (`installType: 'github'`, `managedPath: ''`), then streams `POST /api/comfy/setup/install` (no `targetPath` — triggers full clone).
- Live-streaming terminal output during install (SSE stream from the install route, same as integrations wizard).
- CTA: "Install ComfyUI"

**Option C — Existing Custom Installation**
- Manual path input with folder-browse support (desktop only via `window.desktop.dialog.openDirectory()`).
- Validates the path live via `GET /api/comfy/setup/validate-path` (debounced on input change); enables "Connect" only when `valid: true`. Auto-corrects path if `resolvedPath` differs (e.g. user selected `.app` bundle or parent dir).
- On confirm: calls `POST /api/settings/comfyui-setup` (`installType: 'github'`, `managedPath: resolvedPath`). No install step needed.
- CTA: "Connect"

### Post-selection flow
After any option completes successfully:
1. Auto-run GPU detection (`POST /api/comfy/instances/detect`)
2. Show a "ComfyUI connected — N instances created" confirmation banner (inline, not a separate step)
3. Switch to **Active Dashboard** state

### What is hidden
Everything related to instance management (start/stop, launch scripts, logs) is hidden until setup is complete.

---

## State 2: Active Dashboard (`isSetup === true`)

### Header row
- Left: ComfyUI logo + "ComfyUI Connected" label + instance count badge
- Right: "Edit Configuration" button (subtle secondary style) → opens Configuration Modal
- Right (if any managed instances): "Start All" / "Stop All" bulk buttons (existing behavior)

### Local Instances Card

Lists all managed + external instances (existing `allInstances` logic).

**Each instance row:**
- Device icon (GPU/CPU), label (custom or fallback), port, device name chip, status badge
- Launch script dropdown (if custom scripts configured)
- External badge for non-managed instances
- Action buttons: Start / Restart / Stop / View Log (managed); Stop (external)
- **Editable label** — pencil icon on each managed instance row. Click → field goes inline-editable (input replaces the label text), Enter or blur saves. Calls `/api/settings/comfy-instances` with `{ instances: [{ id, customLabel }] }`. If the saved `customLabel` is empty string, it is cleared and the fallback display is used.
- **Label fallback** — when `customLabel` is absent or empty, display `{gpuName} :{port}` (e.g. `RTX 4090 :41188`) or `CPU :{port}`. `gpuName` is stored on `ComfyInstanceConfig` (see Data Model below) — not parsed from the label string. This fallback applies everywhere: the settings row, the ComputePicker dropdown, and the build-tool test step.
- **Delete button (trash icon)** — managed instances only; disabled (greyed out) when instance is running or starting. On click: stops the instance if needed, removes it from `comfyInstances` in settings, triggers refetch. Calls `DELETE /api/comfy/instances/{id}`.

**"Add Instance" button**
- Appears in the card header
- Disabled with tooltip "All GPUs are in use" when every detected GPU already has a managed instance
- When enabled: opens a small inline dropdown showing unassigned GPUs by name (e.g. "RTX 4090") with their VRAM
- Selecting a GPU calls `POST /api/comfy/instances/add` with `{ gpuIndex: number }`
- Port assignment: `max(port of all existing managed instances) + 1`
- On success: refetch `comfy-manage`, new instance appears in the list

### Cloud Instances Card
- Unchanged from current `ModalComfySection` behavior
- Only shown when Modal is authenticated
- Placed below Local Instances Card

---

## Configuration Modal ("Edit Configuration")

Opened via the "Edit Configuration" button in the Active Dashboard header. Uses the existing `<Modal>` component, `maxWidth="max-w-xl"`, titled "ComfyUI Configuration".

### Sections inside the modal

**Paths & Roots**
- Installation path (currently in Advanced paths accordion)
- Base directory / `--base-directory` override (optional)

**Environment**
- Python executable override (optional)

**Ports**
- Additional ports to scan (add/remove chip UI — existing behavior)

**Custom Launch Scripts**
- Add/remove scripts (existing UI)
- Note: assignment to instances stays in the instance row dropdown

Each section saves individually (existing save mutations). No "Save All" — same UX as today but surfaced cleanly in the modal.

---

## Data Model

### `ComfyInstanceConfig` (in `apps/web/src/lib/providerSettings.ts`)

Two new optional fields:

```typescript
export interface ComfyInstanceConfig {
  id: string
  port: number
  device: string
  label: string          // auto-generated ("GPU 0 — RTX 4090"), kept for backwards compat
  gpuName?: string       // GPU model name only ("RTX 4090"), populated during detect; absent for CPU
  customLabel?: string   // user-editable display name; takes priority over fallback when set
  launchScriptId?: string
}
```

`gpuName` is set to `gpu.name` during `POST /api/comfy/instances/detect` and `POST /api/comfy/instances/add`. CPU instances leave it absent.

The `getInstanceValidation` filter in `getComfyInstances()` must be updated to allow these new optional fields.

### Display label helper (shared utility)

A pure function used in settings UI and `ComputePicker`:

```typescript
export function getInstanceDisplayLabel(inst: { customLabel?: string; gpuName?: string; port: number }): string {
  if (inst.customLabel) return inst.customLabel
  if (inst.gpuName) return `${inst.gpuName} :${inst.port}`
  return `CPU :${inst.port}`
}
```

Lives in `apps/web/src/lib/instanceLabel.ts` (new file, ~10 lines).

### `ComfyManagedInstance` interface (in `settings/page.tsx` / `ComfyUITab.tsx`)

Add matching optional fields: `gpuName?: string` and `customLabel?: string`.

---

## File Changes

### New files
- `apps/web/src/lib/instanceLabel.ts` — `getInstanceDisplayLabel` helper
- `apps/web/src/app/(main)/settings/ComfyUITab.tsx` — all ComfyUI tab components extracted here (see below)
- `apps/web/src/app/api/comfy/instances/add/route.ts` — add single instance endpoint
- `apps/web/src/app/api/comfy/instances/[id]/route.ts` — delete instance endpoint

### `apps/web/src/lib/providerSettings.ts`
- Add `gpuName?: string` and `customLabel?: string` to `ComfyInstanceConfig`
- Update the validation filter in `getComfyInstances()` to pass through unknown optional fields (use a more permissive check or explicitly allow the new fields)

### `apps/web/src/app/api/comfy/instances/detect/route.ts`
- Set `gpuName: gpu.name` on each GPU instance config

### `apps/web/src/app/api/settings/comfy-instances/route.ts`
- Accept `customLabel?: string | null` in the update payload (alongside existing `launchScriptId`)
- Merge `customLabel` into existing config: if `null` or `''`, delete the field; otherwise set it

### `apps/web/src/app/(main)/settings/ComfyUITab.tsx` (new file)
All ComfyUI-specific components extracted from `settings/page.tsx`:
- `ComfyUIBlankState` — 3-path setup wizard; handles all setup API calls + GPU detect post-setup
- `ComfyUIDashboard` — Local Instances Card + Cloud Instances Card
- `ComfyUIConfigModal` — Edit Configuration modal (paths, python, ports, scripts)
- `AddInstanceDropdown` — inline GPU picker in the card header
- `InstanceStatusBadge` — moved here from page.tsx
- `ComfyUITab` — thin router: `isSetup` → `ComfyUIBlankState` or `ComfyUIDashboard`

Keeps the same `showError: (msg: string) => void` prop interface from the parent.

### `apps/web/src/app/(main)/settings/page.tsx`
- Remove `ComfyUITab`, `InstanceStatusBadge`, and all associated state/mutations (moved to `ComfyUITab.tsx`)
- Import and render `ComfyUITab` from `./ComfyUITab`

### `apps/web/src/components/ComputePicker.tsx`
- Import `getInstanceDisplayLabel` from `@/lib/instanceLabel`
- Replace current `inst.label` display with `getInstanceDisplayLabel(inst)`

### New API endpoints

`POST /api/comfy/instances/add`
- Body: `{ gpuIndex: number }`
- Reads detected GPUs via `detectGpus()`, finds the GPU at `gpuIndex`
- Port: `Math.max(...getComfyInstances().map(i => i.port)) + 1`
- Creates `ComfyInstanceConfig` with `id: gpu-{index}`, `gpuName: gpu.name`, `device: cuda:{index}` or `rocm:{index}`
- Appends to existing instances via `setComfyInstances`
- Returns `{ instance: ComfyInstanceConfig }`

`DELETE /api/comfy/instances/[id]`
- Calls `stopInstance(id)` if the instance is currently alive (checked via `getInstanceStatus`)
- Removes the instance from `getComfyInstances()` and calls `setComfyInstances`
- Calls `removePid(id)` to clean up PID file (expose this from `comfyui-manager.ts` or inline the unlink)
- Returns `{ ok: true }`

---

## Constraints & Decisions

- **"Add Instance" — dropdown, not auto:** User picks the specific GPU (Option A confirmed). Disabled with tooltip when all GPUs occupied.
- **Blank state hides everything:** No instance controls visible until `isSetup === true`.
- **Configuration modal, not slide-over:** Uses existing `<Modal>` component for consistency. Individual field saves, not a global "Save" button.
- **Existing `/integrations/comfyui` page:** Not removed or changed by this spec. The blank state wizard supersedes it for the settings tab entry point; the integrations page can be cleaned up separately.
- **External ComfyUI stop confirmation modal:** Unchanged — still a separate `<Modal>` triggered from the instance row.
- **Spawn-log viewer modal:** Unchanged.
- **Delete instance — disabled while running:** The trash icon is greyed out when `status === 'running' || status === 'starting'`. User must stop the instance first. No auto-stop-then-delete to avoid accidental data loss.
- **External stop detection:** The backend already calls `isProcessAlive(pid)` on every `GET /api/comfy/manage` poll, cleaning up stale PID files automatically. The UI fix is to widen the auto-refetch condition from `anyStarting` only to `anyStarting || anyRunning`, polling every 5s whenever any managed instance is running. This ensures externally-killed instances are reflected in the UI within ~5s.
- **Desktop App auto-detect is macOS-only:** The default path `/Applications/ComfyUI.app/...` only exists on macOS. On Linux/Windows the validate-path call will return `valid: false` and the UI falls back to a manual path input. This is acceptable — Desktop App is a macOS product.
- **`removePid` in comfyui-manager.ts is currently private:** The delete endpoint needs to clean up the PID file. Either expose `removePid` as an export, or have the delete endpoint call `stopInstance` (which handles PID cleanup internally) unconditionally before removing from settings.
- **`customLabel` backwards compat:** The `getComfyInstances()` validation filter currently checks `typeof i.label === 'string'`. The new optional fields (`gpuName`, `customLabel`) must pass the filter — update it to allow any additional string-or-undefined fields rather than strictly rejecting unknown keys.
