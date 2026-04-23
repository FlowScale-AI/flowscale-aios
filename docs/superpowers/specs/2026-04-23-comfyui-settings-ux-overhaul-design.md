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
- Auto-detects the Desktop App directory (existing logic from `/integrations/comfyui` wizard, `installType: 'desktop-app'`)
- Shows detected path with a green check; shows "Not found" with a manual override input if not detected
- CTA: "Use Desktop App"

**Option B — Install via FlowScale AIOS**
- Clones ComfyUI from GitHub into `~/.flowscale/comfyui` and runs pip install
- Live-streaming terminal output during install (existing `/api/comfy/setup/install` route + SSE/polling log)
- CTA: "Install ComfyUI"

**Option C — Existing Custom Installation**
- Manual path input with folder-browse support (desktop only)
- Validates that the path looks like a ComfyUI install before enabling "Connect"
- CTA: "Connect"

### Post-selection flow
After any option completes successfully:
1. Auto-run GPU detection (`POST /api/comfy/instances/detect`)
2. Show a "ComfyUI connected — N instances created" confirmation
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
- Device icon (GPU/CPU), label, port, device name chip, status badge
- Launch script dropdown (if custom scripts configured)
- External badge for non-managed instances
- Action buttons: Start / Restart / Stop / View Log (managed); Stop (external)
- **Delete button (trash icon)** — managed instances only; disabled (greyed out) when instance is running or starting. On click: stops the instance if needed, removes it from `comfyInstances` in settings, triggers refetch. Calls `DELETE /api/comfy/instances/{id}`.

**"Add Instance" button**
- Appears in the card header
- Disabled with tooltip "All GPUs are in use" when every detected GPU already has a managed instance
- When enabled: opens a small inline dropdown showing unassigned GPUs by name/index
- Selecting a GPU calls a new endpoint `POST /api/comfy/instances/add` with `{ gpuIndex: number }`, which creates and registers a single new instance for that GPU
- On success: refetch `comfy-manage`, the new instance appears in the list

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

## File Changes

### `apps/web/src/app/(main)/settings/page.tsx`

**New components (all within the same file or co-located):**
- `ComfyUIBlankState` — renders the 3-path setup wizard; handles setup API calls and GPU detection post-setup
- `ComfyUIDashboard` — renders Local Instances Card + Cloud Instances Card; replaces the current flat `ComfyUITab` body
- `ComfyUIConfigModal` — the Edit Configuration modal, containing all the moved advanced settings fields
- `AddInstanceDropdown` — inline GPU picker shown inline in the Local Instances card header

**Removed:**
- The `<details>` Advanced paths accordion (content moves into `ComfyUIConfigModal`)
- The current flat "Setup required" empty state text

**`ComfyUITab` function** becomes a thin router: checks `isSetup`, renders either `ComfyUIBlankState` or `ComfyUIDashboard`.

### New API endpoints

`POST /api/comfy/instances/add`
- Body: `{ gpuIndex: number }`
- Creates a single new managed ComfyUI instance for the specified GPU index
- Returns the new instance record
- Implementation: thin wrapper around existing instance creation logic in `comfyui-manager.ts`

`DELETE /api/comfy/instances/[id]`
- Stops the instance process if running (reuses existing stop logic)
- Removes the instance from `comfyInstances` in `settings.json` via `setComfyInstances`
- Cleans up the PID file
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
