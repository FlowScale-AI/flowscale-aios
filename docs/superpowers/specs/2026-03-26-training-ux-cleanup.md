# Training UX Cleanup: Simplified Cloud Picker + Auto-Start Captioning

**Date:** 2026-03-26
**Branch:** feat/lora-trainer
**Prerequisite:** Ephemeral `modal run` refactor is complete (modal_app.py, modalTraining.ts, route.ts)

## Sub-project 1: Simplified Compute Picker for Training Tools

### Problem

The compute dropdown for training tools still shows pre-deployed Modal apps (e.g. "Cloud · flux1-lora-trainer-a100-80gb-1 (A100-80GB)") and renders a purple `ModalDeployBanner` with deploy/undeploy controls. Since training is now ephemeral (`modal run`), there is nothing to deploy or manage — the dropdown entries and banner are misleading.

### Design

**Compute dropdown** — when the tool is a training plugin (`isTrainingPlugin`), the Cloud optgroup should show a single "Cloud" option instead of listing deployments:

```
Local · Auto-route
Local · GPU 0 — Radeon RX 7700 XT
Local · CPU
─────────────────
Cloud
```

Selecting "Cloud" reveals the GPU tier picker (T4, L4, A10, A100-40GB, A100-80GB, H100) — this already exists and works.

**ModalDeployBanner** — hide it for training tools. The condition `tool.engine === 'api' && isModalSelected && pluginId && modalSupported` should additionally check `!isTrainingPlugin`.

**No backend changes.** The route.ts already handles `provider: 'modal'` without needing a deployment URL (it uses `runModalTraining()` now).

### Files

| File | Change |
|------|--------|
| `apps/web/src/app/(main)/apps/[id]/page.tsx` | Simplify Cloud optgroup for training plugins; hide ModalDeployBanner for training plugins |

---

## Sub-project 2: Auto-Start Captioning Server

### Problem

When a user clicks "Auto-Caption All" on the dataset detail page, they see "Training plugin server is not running. Start it first." The user must manually navigate to the tool page, start the server, come back, and try again. This is a bad experience.

### Design

When the user clicks "Auto-Caption All", the caption API route should automatically:

1. Find the training plugin (existing `findCaptioningPlugin()`)
2. Check if the server is running (existing `isServerRunning()`)
3. If not running, start it automatically:
   - Resolve Python path (`resolvePython()`)
   - Check deps are installed (`areDepsInstalled()`) — if not, return error asking user to install from the tool page
   - Spawn the server (`spawnServer()`)
   - Poll health endpoint until ready (up to 120s)
4. Stream SSE events: first a `{"type":"status","message":"Starting captioning server..."}` event, then the caption events as before
5. After all images are captioned, stop the server (`stopServer()`)

The frontend (`CaptionProgress.tsx`) should handle the new `status` event type to show "Starting captioning server..." in the progress area before the captioning bar begins.

### Error cases

- **Dependencies not installed:** Return 400 with message "Dependencies not installed. Install from the tool page first."
- **Server fails to start within 120s:** Stream an error event and close.
- **Captioning fails mid-batch:** Stream error event (existing behavior). Still stop the server in a `finally` block.

### Files

| File | Change |
|------|--------|
| `apps/web/src/app/api/training/datasets/[id]/caption/route.ts` | Auto-start server before captioning, stop after; stream status events |
| `apps/web/src/components/training/CaptionProgress.tsx` | Handle `status` event type, show server startup message |
