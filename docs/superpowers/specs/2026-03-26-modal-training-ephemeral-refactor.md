# Modal Training Refactor: Ephemeral `modal run` Instead of Persistent Deploy

**Date:** 2026-03-26
**Branch:** feat/lora-trainer
**Prerequisite:** Current Modal training pipeline is working E2E (tested both Flux.1 and Flux.2 trainers)

## Problem

Current flow requires a pre-deployed Modal app that stays running with a 30-min scaledown window. This wastes GPU time, requires manual deployment management, and has in-memory job state issues (container replicas don't share state).

## New Design

Replace `modal deploy` + ASGI web server with `modal run` — an ephemeral function call that:
1. Starts a container on demand
2. Runs ai-toolkit training
3. Streams progress back to the caller
4. Returns the `.safetensors` file
5. Container auto-shuts down

### Key Changes

**`plugins/flux-lora-trainer/modal_app.py`:**
- Remove `@modal.asgi_app()` ASGI server, all HTTP endpoints
- Remove in-memory `_jobs` dict, threading, scaledown_window
- Replace with a single `@app.function()` that:
  - Takes training config dict as input
  - Runs ai-toolkit subprocess
  - Yields progress events (step count, percentage) via `modal.Queue` or return value
  - Returns the `.safetensors` file bytes (or writes to a Modal Volume for download)
- The function blocks until training completes — `modal run` handles the lifecycle

**`apps/web/src/lib/modalTraining.ts`:**
- Remove `startModalTraining()`, `getModalTrainingProgress()` (no more HTTP polling)
- Replace with `runModalTraining()` that calls `modal run` via `modal-helper.py`
- The helper script invokes the Modal function and streams stdout for progress
- On completion, reads the output file from a Modal Volume or direct return

**`apps/web/scripts/modal-helper.py`:**
- Remove `deploy-trainer` command
- Add `run-training` command that:
  - Calls `modal run modal_app.py::train --config <config.json>`
  - Streams stdout (progress lines) to the Node.js caller
  - Outputs final JSON with success/failure and output path

**`apps/web/src/app/api/tools/[id]/executions/route.ts`:**
- The Modal training branch becomes simpler:
  1. Sync dataset to Volume
  2. Call `modal-helper.py run-training` (blocking, streams progress)
  3. Download result from Volume
  4. Save locally + update execution
- No more background polling loop — the `run-training` command blocks until done

**No more needed:**
- `scaledown_window` config
- Pre-deployment step
- Deployment registration in `modal-deployments.json` for trainers
- In-memory job state / threading
- `/train`, `/progress`, `/cancel`, `/download` HTTP endpoints
- GPU tier in deployment (GPU selected per-run instead)

### Progress Tracking

Since `modal run` blocks, progress comes through stdout of the subprocess:
- `modal-helper.py run-training` spawns `modal run`
- ai-toolkit prints step progress to stdout
- The Node.js caller reads stdout line-by-line
- Each progress line updates the execution's `progressJson` in the DB
- Frontend polls `progressJson` from the DB (already works)

### GPU Selection

GPU tier is passed as a parameter to the Modal function, not baked into the deployment:
```python
@app.function(gpu=modal.gpu.A100(count=1, size="80GB"), ...)
def train(config: dict):
    ...
```

Or dynamically via `modal run --gpu` flag, or by having multiple `@app.function` variants.

### Cancellation

- The Node.js process can kill the `modal run` subprocess
- This triggers Modal to terminate the container
- Execution marked as `cancelled` in the DB

### File Structure

| File | Change |
|------|--------|
| `plugins/flux-lora-trainer/modal_app.py` | Rewrite: single `@app.function` instead of ASGI class |
| `apps/web/scripts/modal-helper.py` | Replace `deploy-trainer` with `run-training` |
| `apps/web/src/lib/modalTraining.ts` | Simplify: `runModalTraining()` wraps `modal run` subprocess |
| `apps/web/src/app/api/tools/[id]/executions/route.ts` | Simplify Modal training branch |
| `apps/web/src/app/(main)/apps/[id]/page.tsx` | Remove deploy-trainer UI references |

### Benefits

- Zero idle GPU cost
- No deployment management
- GPU tier selected per-run
- No in-memory state issues
- Simpler code (no ASGI, no threading, no HTTP endpoints)
- No stale container issues
