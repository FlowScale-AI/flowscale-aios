"""
Modal app for FlowScale LoRA training.

Runs ai-toolkit on a cloud GPU. Exposes ASGI endpoints for training control.
Datasets are read from the `flowscale-training-datasets` Volume.
Trained LoRAs are written to the `flowscale-training-outputs` Volume.
"""
import os
import json
import threading
import uuid
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
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        "torch", "torchvision", "transformers", "safetensors", "accelerate",
        "pyyaml", "peft", "bitsandbytes", "fastapi", "uvicorn", "httpx",
        "huggingface_hub", "diffusers", "starlette",
    )
    .run_commands(
        "git clone https://github.com/ostris/ai-toolkit.git /ai-toolkit",
        "cd /ai-toolkit && pip install -e .",
    )
)

_GPU_MAP = {
    "T4": "T4", "L4": "L4", "A10": "A10G", "L40S": "L40S",
    "A100-40GB": "A100-40GB", "A100-80GB": "A100-80GB",
    "H100": "H100", "H200": "H200", "B200": "B200",
}

def _resolve_gpu(gpu_str: str):
    return _GPU_MAP.get(gpu_str, "A100-40GB")


@app.cls(
    image=trainer_image,
    gpu=_resolve_gpu(GPU),
    volumes={"/datasets": datasets_volume, "/outputs": outputs_volume},
    scaledown_window=120,
    timeout=7200,
)
class LoRATrainer:
    @modal.enter()
    def setup(self):
        self._jobs: dict[str, dict] = {}
        self._lock = threading.Lock()
        print("LoRA Trainer container ready.")

    def _new_job(self, job_id: str) -> dict:
        return {
            "id": job_id, "status": "pending", "progress": 0,
            "totalSteps": 0, "currentStep": 0, "message": "",
            "outputPath": None, "error": None,
        }

    def _run_training(self, job_id: str, config: dict):
        import yaml

        dataset_id = config["datasetId"]
        output_name = config["outputName"]
        trigger_word = config.get("triggerWord", "ohwx")
        steps = config.get("steps", 1000)
        lr = config.get("lr", "1e-4")
        rank = config.get("rank", 128)
        resolution = config.get("resolution", 1024)

        dataset_dir = Path(f"/datasets/{dataset_id}")
        output_dir = Path(f"/outputs/{job_id}")
        output_dir.mkdir(parents=True, exist_ok=True)

        if not dataset_dir.exists() or not any(dataset_dir.iterdir()):
            with self._lock:
                self._jobs[job_id]["status"] = "failed"
                self._jobs[job_id]["error"] = f"Dataset '{dataset_id}' not found or empty on Volume"
            return

        model_id = os.environ.get("FLOWSCALE_MODEL_ID", "FLUX.1-dev")
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
                    "save": {"dtype": "float16", "save_every": max(100, steps // 10), "max_step_saves_to_keep": 2},
                    "datasets": [{"folder_path": str(dataset_dir), "caption_ext": "txt", "caption_dropout_rate": 0.05, "resolution": [resolution]}],
                    "train": {
                        "batch_size": 1, "steps": steps, "gradient_accumulation_steps": 1,
                        "train_unet": True, "train_text_encoder": False, "gradient_checkpointing": True,
                        "noise_scheduler": "flowmatch", "optimizer": "adamw8bit", "lr": lr,
                        "ema_config": {"use_ema": True, "ema_decay": 0.99}, "dtype": "bf16",
                    },
                    "model": {"name_or_path": model_id, "is_flux": model_id.startswith("FLUX"), "quantize": True},
                    "sample": {
                        "sampler": "flowmatch", "sample_every": max(200, steps // 5),
                        "width": resolution, "height": resolution,
                        "prompts": [f"a photo of {trigger_word}"], "neg": "",
                        "seed": 42, "walk_seed": True, "guidance_scale": 4, "sample_steps": 20,
                    },
                }],
            },
            "meta": {"name": output_name},
        }

        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as cf:
            yaml.dump(toolkit_config, cf)
            config_path = cf.name

        with self._lock:
            self._jobs[job_id]["status"] = "running"
            self._jobs[job_id]["totalSteps"] = steps
            self._jobs[job_id]["message"] = "Starting training..."

        try:
            proc = subprocess.Popen(
                ["python", "-m", "toolkit.job", config_path],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd="/ai-toolkit",
            )
            for line in proc.stdout:
                line = line.rstrip()
                match = re.search(r"step[:\s]+(\d+)", line, re.IGNORECASE)
                if match:
                    current = int(match.group(1))
                    pct = min(100, int(current / max(steps, 1) * 100))
                    with self._lock:
                        self._jobs[job_id]["currentStep"] = current
                        self._jobs[job_id]["progress"] = pct
                        self._jobs[job_id]["message"] = line
                with self._lock:
                    if self._jobs[job_id]["status"] == "cancelled":
                        proc.terminate()
                        return
            proc.wait()
            if proc.returncode == 0:
                lora_path = output_dir / f"{output_name}.safetensors"
                outputs_volume.commit()
                with self._lock:
                    self._jobs[job_id]["status"] = "completed"
                    self._jobs[job_id]["progress"] = 100
                    self._jobs[job_id]["outputPath"] = str(lora_path)
                    self._jobs[job_id]["message"] = "Training complete"
            else:
                with self._lock:
                    self._jobs[job_id]["status"] = "failed"
                    self._jobs[job_id]["error"] = f"ai-toolkit exited with code {proc.returncode}"
        except Exception as exc:
            with self._lock:
                self._jobs[job_id]["status"] = "failed"
                self._jobs[job_id]["error"] = str(exc)
        finally:
            Path(config_path).unlink(missing_ok=True)

    @modal.asgi_app()
    def serve(self):
        from starlette.applications import Starlette
        from starlette.routing import Route
        from starlette.requests import Request
        from starlette.responses import JSONResponse

        async def health(request: Request):
            return JSONResponse({"status": "ok", "gpu": GPU})

        async def start_train(request: Request):
            body = await request.json()
            job_id = str(uuid.uuid4())
            with self._lock:
                self._jobs[job_id] = self._new_job(job_id)
                self._jobs[job_id]["totalSteps"] = body.get("steps", 1000)
            thread = threading.Thread(target=self._run_training, args=(job_id, body), daemon=True)
            thread.start()
            return JSONResponse({"jobId": job_id})

        async def get_progress(request: Request):
            job_id = request.path_params["job_id"]
            with self._lock:
                job = self._jobs.get(job_id)
            if job is None:
                return JSONResponse({"error": "Job not found"}, status_code=404)
            return JSONResponse(job)

        async def cancel_train(request: Request):
            job_id = request.path_params["job_id"]
            with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    return JSONResponse({"error": "Job not found"}, status_code=404)
                if job["status"] in ("completed", "failed", "cancelled"):
                    return JSONResponse({"ok": True, "status": job["status"]})
                job["status"] = "cancelled"
                job["message"] = "Cancelled by user"
            return JSONResponse({"ok": True, "status": "cancelled"})

        return Starlette(routes=[
            Route("/health", health, methods=["GET"]),
            Route("/train", start_train, methods=["POST"]),
            Route("/train/{job_id}/progress", get_progress, methods=["GET"]),
            Route("/train/{job_id}/cancel", cancel_train, methods=["POST"]),
        ])
