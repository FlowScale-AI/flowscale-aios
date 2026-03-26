# Modal Training Ephemeral Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the persistent `modal deploy` + ASGI server training pipeline with ephemeral `modal run` — eliminating idle GPU cost, deployment management, in-memory state, and HTTP polling.

**Architecture:** The Modal training function becomes a single `@app.function` invoked via `modal run`. Progress is streamed via stdout (Modal streams remote prints to the caller). The Node.js layer spawns `modal-helper.py run-training` as a subprocess, reads structured progress lines, and updates the DB. Output is written to a Modal Volume and downloaded via `modal volume get` after completion.

**Tech Stack:** Python (Modal SDK), TypeScript (Node.js child_process), Modal Volumes, ai-toolkit

**Spec:** `docs/superpowers/specs/2026-03-26-modal-training-ephemeral-refactor.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `plugins/flux-lora-trainer/modal_app.py` | Rewrite | Single `@app.function` + `@app.local_entrypoint()` — runs training, prints progress, writes output to Volume |
| `apps/web/scripts/modal-helper.py` | Modify | Add `run-training` command (spawns `modal run`, streams stdout); remove `deploy-trainer` command |
| `apps/web/src/lib/modalTraining.ts` | Rewrite | Remove HTTP functions; add `runModalTraining()` wrapping subprocess + progress callback |
| `apps/web/src/app/api/tools/[id]/executions/route.ts` | Modify | Simplify Modal training branch: sync → run-training (blocking) → download → save |
| `apps/web/src/lib/__tests__/modalTraining.test.ts` | Modify | Update tests for new exports, add progress parsing tests |

### Progress Protocol

Structured lines printed to stdout by `modal_app.py`, relayed by `modal-helper.py`:

```
PROGRESS:{"step":5,"totalSteps":1000,"pct":0,"message":"Training step 5/1000"}
PROGRESS:{"step":500,"totalSteps":1000,"pct":50,"message":"Training step 500/1000"}
RESULT:{"status":"completed","outputVolumePath":"/outputs/jobid/name.safetensors"}
RESULT:{"status":"failed","error":"Dataset not found"}
```

All other stdout lines are treated as log output (ignored for progress tracking).

---

### Task 1: Rewrite `modal_app.py` — ephemeral function

**Files:**
- Rewrite: `plugins/flux-lora-trainer/modal_app.py`

- [ ] **Step 1: Replace the file with the new ephemeral function design**

Replace the entire `modal_app.py` with:

```python
"""
Modal app for FlowScale LoRA training (ephemeral mode).

Invoked via `modal run modal_app.py` — starts a container, trains, writes output
to Volume, and shuts down. Progress is streamed via stdout.
"""
import os
import json
import subprocess
import tempfile
import re
from pathlib import Path

import modal

GPU = os.environ.get("FLOWSCALE_GPU", "A100-40GB")
APP_NAME = os.environ.get("FLOWSCALE_APP_NAME", "flowscale-lora-trainer")

app = modal.App(APP_NAME)

datasets_volume = modal.Volume.from_name("flowscale-training-datasets", create_if_missing=True)
outputs_volume = modal.Volume.from_name("flowscale-training-outputs", create_if_missing=True)

trainer_image = (
    modal.Image.from_registry("nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git", "ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .run_commands(
        "git clone https://github.com/ostris/ai-toolkit.git /ai-toolkit",
        "cd /ai-toolkit && pip install -r requirements.txt",
        "pip install torchaudio pyyaml",
    )
)

_GPU_MAP = {
    "T4": "T4", "L4": "L4", "A10": "A10G", "L40S": "L40S",
    "A100-40GB": "A100-40GB", "A100-80GB": "A100-80GB",
    "H100": "H100", "H200": "H200", "B200": "B200",
}


def _resolve_gpu(gpu_str: str):
    return _GPU_MAP.get(gpu_str, "A100-40GB")


@app.function(
    image=trainer_image,
    gpu=_resolve_gpu(GPU),
    volumes={"/datasets": datasets_volume, "/outputs": outputs_volume},
    secrets=[modal.Secret.from_name("huggingface-secret", required_keys=["HF_TOKEN"])],
    timeout=7200,
)
def train(config: dict) -> dict:
    """Run ai-toolkit LoRA training. Returns result dict.

    Prints PROGRESS: lines to stdout for real-time tracking.
    Writes output .safetensors to the outputs Volume.
    """
    import yaml

    job_id = config.get("jobId", "unknown")
    dataset_id = config["datasetId"]
    output_name = config["outputName"]
    trigger_word = config.get("triggerWord", "ohwx")
    steps = config.get("steps", 1000)
    lr = float(config.get("lr", "1e-4"))
    rank = config.get("rank", 128)
    resolution = config.get("resolution", 1024)

    dataset_dir = Path(f"/datasets/{dataset_id}")
    output_dir = Path(f"/outputs/{job_id}")
    output_dir.mkdir(parents=True, exist_ok=True)

    if not dataset_dir.exists() or not any(dataset_dir.iterdir()):
        return {"status": "failed", "error": f"Dataset '{dataset_id}' not found or empty on Volume"}

    model_id = os.environ.get("FLOWSCALE_MODEL_ID", "black-forest-labs/FLUX.1-dev")
    toolkit_config = {
        "job": "extension",
        "config": {
            "name": output_name,
            "process": [{
                "type": "sd_trainer",
                "training_folder": str(output_dir),
                "device": "cuda:0",
                "trigger_word": trigger_word,
                "network": {"type": "lora", "linear": rank, "linear_alpha": rank},
                "save": {
                    "dtype": "float16",
                    "save_every": min(steps, max(100, steps // 10)),
                    "max_step_saves_to_keep": 2,
                    "save_last": True,
                },
                "datasets": [{
                    "folder_path": str(dataset_dir),
                    "caption_ext": "txt",
                    "caption_dropout_rate": 0.05,
                    "resolution": [resolution],
                }],
                "train": {
                    "batch_size": 1, "steps": steps, "gradient_accumulation_steps": 1,
                    "train_unet": True, "train_text_encoder": False,
                    "gradient_checkpointing": True, "noise_scheduler": "flowmatch",
                    "optimizer": "adamw8bit", "lr": lr,
                    "ema_config": {"use_ema": True, "ema_decay": 0.99}, "dtype": "bf16",
                },
                "model": {
                    "name_or_path": model_id,
                    "is_flux": "flux" in model_id.lower(),
                    "quantize": config.get("quantize", False),
                },
                "sample": {
                    "sampler": "flowmatch",
                    "sample_every": max(200, steps // 5),
                    "width": resolution, "height": resolution,
                    "prompts": [f"a photo of {trigger_word}"], "neg": "",
                    "seed": 42, "walk_seed": True,
                    "guidance_scale": 4, "sample_steps": 20,
                },
            }],
        },
        "meta": {"name": output_name},
    }

    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as cf:
        yaml.dump(toolkit_config, cf)
        config_path = cf.name

    try:
        print(f"PROGRESS:{json.dumps({'step': 0, 'totalSteps': steps, 'pct': 0, 'message': 'Starting training...'})}")

        proc = subprocess.Popen(
            ["python", "run.py", config_path],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd="/ai-toolkit",
        )

        for line in proc.stdout:
            line = line.rstrip()
            print(f"[ai-toolkit] {line}")
            match = re.search(r"step[:\s]+(\d+)", line, re.IGNORECASE)
            if match:
                current = int(match.group(1))
                pct = min(100, int(current / max(steps, 1) * 100))
                print(f"PROGRESS:{json.dumps({'step': current, 'totalSteps': steps, 'pct': pct, 'message': line})}")

        proc.wait()

        if proc.returncode != 0:
            return {"status": "failed", "error": f"ai-toolkit exited with code {proc.returncode}"}

        # Find the output .safetensors file
        all_safetensors = list(output_dir.rglob("*.safetensors"))
        lora_path = output_dir / f"{output_name}.safetensors"
        if not lora_path.exists() and all_safetensors:
            lora_path = all_safetensors[-1]

        if not lora_path.exists():
            all_files = list(output_dir.rglob("*"))
            return {
                "status": "failed",
                "error": f"No .safetensors found. Files: {[str(f.relative_to(output_dir)) for f in all_files[:20]]}",
            }

        # Commit Volume writes so they're visible to `modal volume get`
        outputs_volume.commit()

        output_volume_path = str(lora_path)
        return {"status": "completed", "outputVolumePath": output_volume_path}

    except Exception as exc:
        return {"status": "failed", "error": str(exc)}
    finally:
        Path(config_path).unlink(missing_ok=True)


@app.local_entrypoint()
def main(config_json: str = "{}"):
    """Local entrypoint — called by `modal run modal_app.py --config-json '{...}'`."""
    config = json.loads(config_json)
    result = train.remote(config)
    print(f"RESULT:{json.dumps(result)}")
```

- [ ] **Step 2: Verify the file is syntactically valid**

Run: `python3 -c "import ast; ast.parse(open('plugins/flux-lora-trainer/modal_app.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add plugins/flux-lora-trainer/modal_app.py
git commit -m "refactor: rewrite modal_app.py as ephemeral function (modal run)"
```

---

### Task 2: Add `run-training` command to `modal-helper.py`

**Files:**
- Modify: `apps/web/scripts/modal-helper.py`

- [ ] **Step 1: Add the `cmd_run_training` function**

Add after the existing `cmd_deploy_trainer` function (around line 673):

```python
def cmd_run_training(plugin_dir: str, config_json: str, gpu: str, app_name: str = "flowscale-lora-trainer"):
    """Run ephemeral LoRA training via `modal run`.

    Streams stdout (PROGRESS: and RESULT: lines) to the Node.js caller.
    """
    modal_app_path = os.path.join(plugin_dir, "modal_app.py")
    if not os.path.exists(modal_app_path):
        _json_out({"success": False, "error": f"modal_app.py not found in {plugin_dir}"})
        return

    env = {
        **os.environ,
        "FLOWSCALE_GPU": gpu,
        "FLOWSCALE_APP_NAME": app_name,
        "PYTHONIOENCODING": "utf-8",
    }

    try:
        proc = subprocess.Popen(
            [MODAL_BIN, "run", modal_app_path, "--config-json", config_json],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            cwd=plugin_dir,
        )

        result_line = None
        for line in proc.stdout:
            line = line.rstrip()
            if line.startswith("PROGRESS:"):
                # Relay progress lines directly to Node.js
                print(line, flush=True)
            elif line.startswith("RESULT:"):
                result_line = line[len("RESULT:"):]
                print(line, flush=True)
            # Other lines (ai-toolkit logs) are ignored for the caller

        # Also capture stderr for error diagnostics
        stderr_output = proc.stderr.read()
        proc.wait(timeout=7500)  # slightly above modal_app.py's 7200s timeout

        if result_line:
            # The RESULT line contains the train() return value
            result = json.loads(result_line)
            _json_out({"success": result.get("status") == "completed", **result})
        elif proc.returncode != 0:
            _json_out({"success": False, "error": stderr_output.strip() or f"modal run exited with code {proc.returncode}"})
        else:
            _json_out({"success": False, "error": "No RESULT line received from training function"})

    except subprocess.TimeoutExpired:
        proc.kill()
        _json_out({"success": False, "error": "modal run timed out"})
    except Exception as e:
        _json_out({"success": False, "error": str(e)})
```

- [ ] **Step 2: Remove the `cmd_deploy_trainer` function**

Delete the `cmd_deploy_trainer` function (lines 625–673 in the current file).

- [ ] **Step 3: Update the `__main__` CLI dispatch**

Replace the `deploy-trainer` entry in the CLI dispatch block with `run-training`:

```python
    elif command == "run-training" and len(sys.argv) >= 5:
        # run-training <plugin-dir> <config-json> <gpu> [app-name]
        app_name = sys.argv[5] if len(sys.argv) >= 6 else "flowscale-lora-trainer"
        cmd_run_training(sys.argv[2], sys.argv[3], sys.argv[4], app_name)
```

Also update the usage string at the top of the file docstring to mention `run-training` instead of `deploy-trainer`.

- [ ] **Step 4: Verify syntax**

Run: `python3 -c "import ast; ast.parse(open('apps/web/scripts/modal-helper.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/modal-helper.py
git commit -m "refactor: replace deploy-trainer with run-training in modal-helper.py"
```

---

### Task 3: Rewrite `modalTraining.ts`

**Files:**
- Rewrite: `apps/web/src/lib/modalTraining.ts`
- Modify: `apps/web/src/lib/__tests__/modalTraining.test.ts`

- [ ] **Step 1: Update the test file for new exports**

Replace `apps/web/src/lib/__tests__/modalTraining.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildDatasetSyncArgs, buildTrainingPayload, parseProgressLine } from '../modalTraining'

describe('buildDatasetSyncArgs', () => {
  it('returns correct args for sync-dataset command', () => {
    const args = buildDatasetSyncArgs('/home/user/.flowscale/training-datasets/abc123', 'abc123')
    expect(args).toEqual(['sync-dataset', '/home/user/.flowscale/training-datasets/abc123', 'abc123', 'flowscale-training-datasets'])
  })
})

describe('buildTrainingPayload', () => {
  it('builds payload from tool inputs', () => {
    const inputs = {
      'api__datasetId': 'abc123',
      'api__outputName': 'my-lora',
      'api__triggerWord': 'ohwx',
      'api__steps': 1000,
      'api__lr': '1e-4',
      'api__rank': 128,
      'api__resolution': 1024,
    }
    const payload = buildTrainingPayload(inputs)
    expect(payload).toEqual({
      datasetId: 'abc123',
      outputName: 'my-lora',
      triggerWord: 'ohwx',
      steps: 1000,
      lr: '1e-4',
      rank: 128,
      resolution: 1024,
    })
  })

  it('uses defaults for missing optional fields', () => {
    const inputs = {
      'api__datasetId': 'abc123',
      'api__outputName': 'my-lora',
    }
    const payload = buildTrainingPayload(inputs)
    expect(payload.triggerWord).toBe('ohwx')
    expect(payload.steps).toBe(1000)
    expect(payload.rank).toBe(128)
  })

  it('throws if datasetId is missing', () => {
    expect(() => buildTrainingPayload({ 'api__outputName': 'x' })).toThrow('datasetId is required')
  })

  it('throws if outputName is missing', () => {
    expect(() => buildTrainingPayload({ 'api__datasetId': 'x' })).toThrow('outputName is required')
  })
})

describe('parseProgressLine', () => {
  it('parses a PROGRESS line', () => {
    const line = 'PROGRESS:{"step":50,"totalSteps":1000,"pct":5,"message":"step 50"}'
    const result = parseProgressLine(line)
    expect(result).toEqual({ type: 'progress', data: { step: 50, totalSteps: 1000, pct: 5, message: 'step 50' } })
  })

  it('parses a RESULT line with completed status', () => {
    const line = 'RESULT:{"status":"completed","outputVolumePath":"/outputs/abc/my-lora.safetensors"}'
    const result = parseProgressLine(line)
    expect(result).toEqual({ type: 'result', data: { status: 'completed', outputVolumePath: '/outputs/abc/my-lora.safetensors' } })
  })

  it('parses a RESULT line with failed status', () => {
    const line = 'RESULT:{"status":"failed","error":"Dataset not found"}'
    const result = parseProgressLine(line)
    expect(result).toEqual({ type: 'result', data: { status: 'failed', error: 'Dataset not found' } })
  })

  it('returns null for non-protocol lines', () => {
    expect(parseProgressLine('[ai-toolkit] Loading model...')).toBeNull()
    expect(parseProgressLine('')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseProgressLine('PROGRESS:{bad json')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @flowscale/aios-web test -- src/lib/__tests__/modalTraining.test.ts`
Expected: FAIL — `parseProgressLine` not exported

- [ ] **Step 3: Rewrite `modalTraining.ts`**

Replace `apps/web/src/lib/modalTraining.ts`:

```typescript
import { spawn } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, copyFileSync, mkdirSync } from 'fs'
import { getDatasetDir, getDatasetSyncStatus, markDatasetSynced } from './training'
import { getComfyManagedPath } from './providerSettings'

const HELPER_SCRIPT = join(process.cwd(), 'scripts', 'modal-helper.py')
const API_OUTPUTS_DIR = join(homedir(), '.flowscale', 'aios-outputs')
const DATASETS_VOLUME = 'flowscale-training-datasets'
const OUTPUTS_VOLUME = 'flowscale-training-outputs'

// Path to the trainer plugin directory (contains modal_app.py)
const TRAINER_PLUGIN_DIR = join(process.cwd(), '..', '..', 'plugins', 'flux-lora-trainer')

export interface TrainingPayload {
  datasetId: string
  outputName: string
  triggerWord: string
  steps: number
  lr: string
  rank: number
  resolution: number
  quantize?: boolean
}

export interface TrainingProgress {
  step: number
  totalSteps: number
  pct: number
  message: string
}

export interface TrainingResult {
  success: boolean
  status?: string
  outputVolumePath?: string
  error?: string
}

export function buildDatasetSyncArgs(datasetDir: string, datasetId: string): string[] {
  return ['sync-dataset', datasetDir, datasetId, DATASETS_VOLUME]
}

export function buildTrainingPayload(inputs: Record<string, unknown>): TrainingPayload {
  const datasetId = (inputs['api__datasetId'] ?? inputs['datasetId']) as string | undefined
  const outputName = (inputs['api__outputName'] ?? inputs['outputName']) as string | undefined
  if (!datasetId) throw new Error('datasetId is required')
  if (!outputName) throw new Error('outputName is required')

  return {
    datasetId,
    outputName,
    triggerWord: (inputs['api__triggerWord'] ?? inputs['triggerWord'] ?? 'ohwx') as string,
    steps: Number(inputs['api__steps'] ?? inputs['steps'] ?? 1000),
    lr: String(inputs['api__lr'] ?? inputs['lr'] ?? inputs['learningRate'] ?? '1e-4'),
    rank: Number(inputs['api__rank'] ?? inputs['rank'] ?? inputs['loraRank'] ?? 128),
    resolution: Number(inputs['api__resolution'] ?? inputs['resolution'] ?? 1024),
  }
}

export function parseProgressLine(line: string): { type: 'progress'; data: TrainingProgress } | { type: 'result'; data: Record<string, unknown> } | null {
  if (line.startsWith('PROGRESS:')) {
    try {
      return { type: 'progress', data: JSON.parse(line.slice('PROGRESS:'.length)) as TrainingProgress }
    } catch { return null }
  }
  if (line.startsWith('RESULT:')) {
    try {
      return { type: 'result', data: JSON.parse(line.slice('RESULT:'.length)) as Record<string, unknown> }
    } catch { return null }
  }
  return null
}

export async function syncDatasetToModal(datasetId: string): Promise<void> {
  const syncStatus = getDatasetSyncStatus(datasetId)
  if (syncStatus.synced) return

  const datasetDir = getDatasetDir(datasetId)
  if (!existsSync(datasetDir)) throw new Error(`Dataset "${datasetId}" not found locally`)

  const args = buildDatasetSyncArgs(datasetDir, datasetId)
  const result = await runHelper(args)
  const parsed = JSON.parse(result)
  if (!parsed.success) throw new Error(parsed.error || 'Dataset sync failed')

  markDatasetSynced(datasetId)
}

export interface TrainingHandle {
  /** Resolves when training completes or fails. */
  result: Promise<TrainingResult>
  /** Kill the subprocess tree — Modal will terminate the remote container. */
  cancel: () => void
}

/**
 * Run Modal training via `modal run` (ephemeral).
 *
 * Spawns `modal-helper.py run-training`, streams progress via callback.
 * Returns a handle with a `result` promise and a `cancel()` method.
 */
export function runModalTraining(
  payload: TrainingPayload & { jobId: string },
  gpu: string,
  onProgress: (progress: TrainingProgress) => void,
): TrainingHandle {
  const configJson = JSON.stringify(payload)
  const args = ['run-training', TRAINER_PLUGIN_DIR, configJson, gpu]

  const proc = spawn('python3', [HELPER_SCRIPT, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 7_500_000, // slightly above Modal's 7200s timeout
  })

  const result = new Promise<TrainingResult>((resolve, reject) => {
    let lastLine = ''
    let resultData: TrainingResult | null = null

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const lines = (lastLine + text).split('\n')
      lastLine = lines.pop() ?? ''

      for (const line of lines) {
        const parsed = parseProgressLine(line.trim())
        if (parsed?.type === 'progress') {
          onProgress(parsed.data)
        }
      }
    })

    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      // Process any remaining buffered line
      if (lastLine.trim()) {
        const parsed = parseProgressLine(lastLine.trim())
        if (parsed?.type === 'progress') onProgress(parsed.data)
      }

      // The last line of stdout is the JSON result from modal-helper
      const allOutput = lastLine.trim()
      try {
        resultData = JSON.parse(allOutput) as TrainingResult
      } catch {
        // Could not parse result
      }

      if (resultData) {
        resolve(resultData)
      } else if (code !== 0) {
        reject(new Error(stderr.trim() || `modal-helper exited with code ${code}`))
      } else {
        reject(new Error('No result received from training'))
      }
    })

    proc.on('error', reject)
  })

  return {
    result,
    cancel: () => { proc.kill('SIGTERM') },
  }
}

/**
 * Download trained LoRA from Modal Volume and save locally.
 */
export async function downloadTrainingOutput(
  volumePath: string,
  outputName: string,
  toolId: string,
  executionId: string,
): Promise<{ localPath: string; apiPath: string; lorasCopyPath: string | null }> {
  const toolDir = join(API_OUTPUTS_DIR, toolId)
  mkdirSync(toolDir, { recursive: true })
  const destFilename = `${executionId.slice(0, 8)}_${outputName}.safetensors`
  const destPath = join(toolDir, destFilename)

  // Download from Modal Volume
  const args = ['download-training-output', OUTPUTS_VOLUME, volumePath, destPath]
  const result = await runHelper(args)
  const parsed = JSON.parse(result)
  if (!parsed.success) throw new Error(parsed.error || 'Failed to download from Volume')

  // Copy to ComfyUI loras dir if available
  let lorasCopyPath: string | null = null
  try {
    const comfyPath = getComfyManagedPath()
    if (comfyPath) {
      const lorasDir = join(comfyPath, 'models', 'loras')
      if (existsSync(lorasDir)) {
        lorasCopyPath = join(lorasDir, `${outputName}.safetensors`)
        copyFileSync(destPath, lorasCopyPath)
      }
    }
  } catch { /* non-fatal */ }

  return { localPath: destPath, apiPath: `/api/outputs/${toolId}/${destFilename}`, lorasCopyPath }
}

function runHelper(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [HELPER_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0 && !out.trim()) reject(new Error(`modal-helper exited with code ${code}`))
      else resolve(out.trim())
    })
    proc.on('error', reject)
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @flowscale/aios-web test -- src/lib/__tests__/modalTraining.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/modalTraining.ts apps/web/src/lib/__tests__/modalTraining.test.ts
git commit -m "refactor: rewrite modalTraining.ts for ephemeral modal run"
```

---

### Task 4: Simplify Modal training branch in `route.ts`

**Files:**
- Modify: `apps/web/src/app/api/tools/[id]/executions/route.ts`

- [ ] **Step 1: Update imports**

In the import block, change:

```typescript
import { syncDatasetToModal, startModalTraining, getModalTrainingProgress, downloadTrainingOutput, buildTrainingPayload, type TrainingPayload } from '@/lib/modalTraining'
```

to:

```typescript
import { syncDatasetToModal, runModalTraining, downloadTrainingOutput, buildTrainingPayload, type TrainingPayload, type TrainingHandle } from '@/lib/modalTraining'
```

Also remove the unused `getModalDeployUrl` and `autoRouteModalDeployment` imports:

```typescript
import { getModalDeployUrl, autoRouteModalDeployment } from '@/lib/modal-deploy'
```

Remove this line entirely (these are no longer needed for the training branch — check if they're still used elsewhere in the file for the non-training Modal execution branch before removing; if they are, keep the import).

- [ ] **Step 2: Replace the Modal cloud training branch**

Replace the entire `if (isModalTraining) { ... }` block (approximately lines 323–428) with:

```typescript
      if (isModalTraining) {
        // ── Modal cloud training (ephemeral `modal run`) ─────────────────
        const currentUser = getRequestUser(req)
        const executionId = uuidv4()

        let payload: TrainingPayload
        try {
          payload = buildTrainingPayload(inputs ?? {})
          const highVramGpus = ['H100', 'H200', 'B200', 'A100-80GB']
          if (gpuTier && highVramGpus.includes(gpuTier as string)) {
            payload.quantize = false
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Invalid training inputs'
          return NextResponse.json({ error: msg }, { status: 400 })
        }

        await db.insert(executions).values({
          id: executionId,
          toolId,
          userId: currentUser?.id ?? null,
          inputsJson: JSON.stringify(payload),
          outputsJson: null,
          seed: 0,
          promptId: null,
          workflowHash: tool.workflowHash,
          status: 'running',
          comfyPort: null,
          createdAt: Date.now(),
        })
        db.update(tools).set({ lastUsedAt: Date.now() }).where(eq(tools.id, toolId)).run()

        const resolvedGpu = (gpuTier as string) || 'A100-40GB'

        // Fire and forget — sync, train (blocking with progress), download
        ;(async () => {
          try {
            await db.update(executions).set({ progressJson: JSON.stringify({ message: 'Syncing dataset to cloud...' }) })
              .where(eq(executions.id, executionId))
            await syncDatasetToModal(payload.datasetId)

            await db.update(executions).set({ progressJson: JSON.stringify({ message: 'Starting training on Modal...' }) })
              .where(eq(executions.id, executionId))

            const handle = runModalTraining(
              { ...payload, jobId: executionId },
              resolvedGpu,
              (progress) => {
                db.update(executions).set({ progressJson: JSON.stringify(progress) })
                  .where(eq(executions.id, executionId)).run()
              },
            )

            // Store handle for cancellation support
            inFlightControllers.set(executionId, { abort: () => handle.cancel() } as unknown as AbortController)

            const result = await handle.result

            if (result.success && result.outputVolumePath) {
              await db.update(executions).set({ progressJson: JSON.stringify({ message: 'Downloading trained LoRA...' }) })
                .where(eq(executions.id, executionId))

              const output = await downloadTrainingOutput(
                result.outputVolumePath, payload.outputName, toolId, executionId,
              )

              await db.update(executions).set({
                status: 'completed',
                outputsJson: JSON.stringify([{
                  kind: 'file',
                  filename: `${executionId.slice(0, 8)}_${payload.outputName}.safetensors`,
                  path: output.apiPath,
                  lorasCopyPath: output.lorasCopyPath,
                }]),
                completedAt: Date.now(),
              }).where(eq(executions.id, executionId))
            } else {
              await db.update(executions).set({
                status: 'error',
                errorMessage: result.error || 'Training failed',
                completedAt: Date.now(),
              }).where(eq(executions.id, executionId))
            }
          } catch (err) {
            console.error(`Modal training failed for ${executionId}:`, err)
            await db.update(executions).set({
              status: 'error',
              errorMessage: err instanceof Error ? err.message : 'Modal training failed',
              completedAt: Date.now(),
            }).where(eq(executions.id, executionId))
          } finally {
            inFlightControllers.delete(executionId)
          }
        })()

        return NextResponse.json({ id: executionId, executionId, type: 'modal-training' }, { status: 202 })
      }
```

- [ ] **Step 3: Clean up unused imports if `getModalDeployUrl`/`autoRouteModalDeployment` are only used in the training branch**

Check: the non-training Modal execution branch (around line 471+) also uses `autoRouteModalDeployment` and `getModalDeployUrl`. If so, keep those imports. Only remove if they're solely used in the training branch you just replaced.

Since the non-training Modal branch (lines 471–528) uses both `autoRouteModalDeployment` and `getModalDeployUrl`, keep those imports.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 5: Run existing tests**

Run: `pnpm --filter @flowscale/aios-web test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/tools/[id]/executions/route.ts
git commit -m "refactor: simplify Modal training to use ephemeral modal run"
```

---

### Task 5: Clean up — remove stale references

**Files:**
- Modify: `plugins/flux-lora-trainer/modal_app.py` (already done in Task 1)
- Verify: no remaining references to removed functions

- [ ] **Step 1: Search for stale references**

Run these searches:
- `grep -r "startModalTraining" apps/web/src/` — should only appear in test file (if at all) and old imports
- `grep -r "getModalTrainingProgress" apps/web/src/` — should be gone
- `grep -r "deploy-trainer" .` — should only appear in `modal-helper.py` if at all
- `grep -r "scaledown_window" .` — should be gone from `modal_app.py`

Expected: No stale references remain.

- [ ] **Step 2: Remove the `fastapi uvicorn starlette httpx` pip install from `modal_app.py`**

Verify: In the Task 1 rewrite, the `trainer_image` only installs `torchaudio pyyaml` (not `fastapi uvicorn starlette httpx`). This is already done.

- [ ] **Step 3: Run full typecheck and tests**

Run: `pnpm typecheck && pnpm --filter @flowscale/aios-web test`
Expected: All pass

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A
git commit -m "chore: clean up stale modal training references"
```

(Only if there were changes to commit. Skip if clean.)

---

## Verification Checklist

After all tasks are complete:

- [ ] `modal_app.py` has no `@modal.asgi_app()`, no `Starlette`, no `_jobs` dict, no threading, no `scaledown_window`
- [ ] `modal-helper.py` has `run-training` command, no `deploy-trainer` command
- [ ] `modalTraining.ts` has `runModalTraining()`, no `startModalTraining()`, no `getModalTrainingProgress()`
- [ ] `route.ts` Modal training branch uses `runModalTraining()` — no HTTP polling loop
- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @flowscale/aios-web test` passes
- [ ] `downloadTrainingOutput` now downloads from Volume (not HTTP)
