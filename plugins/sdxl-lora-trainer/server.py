"""
LoRA Trainer server — shared implementation for Flux and SDXL plugins.
The model ID is read from the plugin manifest at startup so this file is
identical across trainer plugins; only the manifest differs.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Load plugin manifest (sits next to this file)
# ---------------------------------------------------------------------------
_MANIFEST_PATH = Path(__file__).parent / "manifest.json"
with _MANIFEST_PATH.open() as _f:
    _MANIFEST: dict[str, Any] = json.load(_f)

PLUGIN_ID: str = _MANIFEST["id"]
MODEL_ID: str = _MANIFEST.get("model", "SDXL")
PORT: int = _MANIFEST["server"]["port"]

# ---------------------------------------------------------------------------
# Job state
# ---------------------------------------------------------------------------
_jobs: dict[str, dict[str, Any]] = {}
_job_lock = threading.Lock()


def _new_job(job_id: str) -> dict[str, Any]:
    return {
        "id": job_id,
        "status": "pending",  # pending | running | completed | failed | cancelled
        "progress": 0,
        "totalSteps": 0,
        "currentStep": 0,
        "message": "",
        "outputPath": None,
        "error": None,
    }


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title=f"{PLUGIN_ID} server")


@app.get("/health")
def health():
    return {"status": "ok", "plugin": PLUGIN_ID, "model": MODEL_ID}


# ---------------------------------------------------------------------------
# Training request schema
# ---------------------------------------------------------------------------
class TrainRequest(BaseModel):
    datasetId: str
    outputName: str
    triggerWord: str = "ohwx"
    steps: int = 800
    lr: str = "1e-4"
    rank: int = 128
    resolution: int = 1024


@app.post("/train")
def start_training(req: TrainRequest):
    job_id = str(uuid.uuid4())
    with _job_lock:
        _jobs[job_id] = _new_job(job_id)
        _jobs[job_id]["totalSteps"] = req.steps

    thread = threading.Thread(
        target=_run_training,
        args=(job_id, req),
        daemon=True,
    )
    thread.start()

    return {"jobId": job_id}


@app.get("/train/{job_id}/progress")
def get_progress(job_id: str):
    with _job_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.post("/train/{job_id}/cancel")
def cancel_training(job_id: str):
    with _job_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if job["status"] in ("completed", "failed", "cancelled"):
            return {"ok": True, "status": job["status"]}
        job["status"] = "cancelled"
        job["message"] = "Cancelled by user"
    return {"ok": True, "status": "cancelled"}


# Generate endpoint (not used for training but required by plugin protocol)
@app.post("/generate")
def generate(body: dict = None):
    raise HTTPException(status_code=400, detail="This plugin is a trainer; use /train instead.")


# ---------------------------------------------------------------------------
# Training worker
# ---------------------------------------------------------------------------
def _run_training(job_id: str, req: TrainRequest):
    """
    Drives ai-toolkit training for the given job.
    Updates _jobs[job_id] in-place so progress polling works.
    """
    import subprocess
    import tempfile

    dataset_dir = Path(os.environ.get("FLOWSCALE_DATASETS_DIR", Path.home() / ".flowscale" / "datasets")) / req.datasetId
    output_dir = Path(os.environ.get("FLOWSCALE_OUTPUTS_DIR", Path.home() / ".flowscale" / "loras"))
    output_dir.mkdir(parents=True, exist_ok=True)

    config = _build_config(req, dataset_dir, output_dir)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as cf:
        import yaml
        yaml.dump(config, cf)
        config_path = cf.name

    with _job_lock:
        _jobs[job_id]["status"] = "running"
        _jobs[job_id]["message"] = "Starting training…"

    try:
        proc = subprocess.Popen(
            ["python", "-m", "toolkit.job", config_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        for line in proc.stdout:
            line = line.rstrip()
            # Parse simple "step N/M" progress lines emitted by ai-toolkit
            if "step" in line.lower():
                _parse_progress(job_id, line, req.steps)

            with _job_lock:
                if _jobs[job_id]["status"] == "cancelled":
                    proc.terminate()
                    return

        proc.wait()

        with _job_lock:
            if _jobs[job_id]["status"] == "cancelled":
                return

        if proc.returncode == 0:
            lora_path = output_dir / f"{req.outputName}.safetensors"
            with _job_lock:
                _jobs[job_id]["status"] = "completed"
                _jobs[job_id]["progress"] = 100
                _jobs[job_id]["outputPath"] = str(lora_path)
                _jobs[job_id]["message"] = "Training complete"
        else:
            with _job_lock:
                _jobs[job_id]["status"] = "failed"
                _jobs[job_id]["error"] = f"Training process exited with code {proc.returncode}"

    except Exception as exc:
        with _job_lock:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = str(exc)
    finally:
        Path(config_path).unlink(missing_ok=True)


def _parse_progress(job_id: str, line: str, total_steps: int):
    import re
    match = re.search(r"step[:\s]+(\d+)", line, re.IGNORECASE)
    if match:
        current = int(match.group(1))
        pct = min(100, int(current / max(total_steps, 1) * 100))
        with _job_lock:
            _jobs[job_id]["currentStep"] = current
            _jobs[job_id]["progress"] = pct
            _jobs[job_id]["message"] = line


def _build_config(req: TrainRequest, dataset_dir: Path, output_dir: Path) -> dict:
    """Build an ai-toolkit YAML config dict for this training run."""
    return {
        "job": "extension",
        "config": {
            "name": req.outputName,
            "process": [
                {
                    "type": "sd_trainer",
                    "training_folder": str(output_dir),
                    "device": "cuda:0",
                    "trigger_word": req.triggerWord,
                    "network": {
                        "type": "lora",
                        "linear": req.rank,
                        "linear_alpha": req.rank,
                    },
                    "save": {
                        "dtype": "float16",
                        "save_every": max(100, req.steps // 10),
                        "max_step_saves_to_keep": 2,
                    },
                    "datasets": [
                        {
                            "folder_path": str(dataset_dir),
                            "caption_ext": "txt",
                            "caption_dropout_rate": 0.05,
                            "resolution": [req.resolution],
                        }
                    ],
                    "train": {
                        "batch_size": 1,
                        "steps": req.steps,
                        "gradient_accumulation_steps": 1,
                        "train_unet": True,
                        "train_text_encoder": False,
                        "gradient_checkpointing": True,
                        "noise_scheduler": "flowmatch",
                        "optimizer": "adamw8bit",
                        "lr": req.lr,
                        "ema_config": {"use_ema": True, "ema_decay": 0.99},
                        "dtype": "bf16",
                    },
                    "model": {
                        "name_or_path": MODEL_ID,
                        "is_flux": MODEL_ID.startswith("FLUX"),
                        "quantize": True,
                    },
                    "sample": {
                        "sampler": "flowmatch",
                        "sample_every": max(200, req.steps // 5),
                        "width": req.resolution,
                        "height": req.resolution,
                        "prompts": [f"a photo of {req.triggerWord}"],
                        "neg": "",
                        "seed": 42,
                        "walk_seed": True,
                        "guidance_scale": 4,
                        "sample_steps": 20,
                    },
                }
            ],
        },
        "meta": {"name": req.outputName},
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
