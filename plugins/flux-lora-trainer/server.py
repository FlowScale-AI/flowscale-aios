"""
Flux LoRA Trainer plugin server.
Flask server wrapping ai-toolkit for LoRA training jobs.
"""

import json
import os
import re
import signal
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

import yaml
from flask import Flask, Response, jsonify, request, stream_with_context

import captioner

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Job registry
# ---------------------------------------------------------------------------

# jobs[jobId] = {
#   "status":   "running" | "completed" | "error" | "cancelled",
#   "process":  subprocess.Popen | None,
#   "cancel":   threading.Event,
#   "log_lines": [str, ...],        # raw stdout lines
#   "steps":    [{"step": int, "loss": float, "speed": float}, ...],
#   "output":   str | None,         # path to final .safetensors file
#   "error":    str | None,
# }
_jobs: dict = {}
_jobs_lock = threading.Lock()


# ---------------------------------------------------------------------------
# YAML config generator
# ---------------------------------------------------------------------------

def _build_aitoolkit_config(params: dict, output_dir: str) -> dict:
    """
    Map UI params to an ai-toolkit training YAML config dict.
    See: https://github.com/ostris/ai-toolkit
    """
    dataset_id = params["datasetId"]
    output_name = params.get("outputName", "flux-lora")
    trigger_word = params.get("triggerWord", "ohwx")
    steps = int(params.get("steps", 1000))
    lr = params.get("lr", "1e-4")
    rank = int(params.get("rank", 128))
    resolution = int(params.get("resolution", 1024))

    # Dataset directory — callers place images under ~/.flowscale/datasets/<datasetId>/
    datasets_root = Path.home() / ".flowscale" / "datasets"
    dataset_path = str(datasets_root / dataset_id)

    config = {
        "job": "extension",
        "config": {
            "name": output_name,
            "process": [
                {
                    "type": "sd_trainer",
                    "training_folder": output_dir,
                    "device": "cuda:0",
                    "trigger_word": trigger_word,
                    "network": {
                        "type": "lora",
                        "linear": rank,
                        "linear_alpha": rank,
                    },
                    "save": {
                        "dtype": "float16",
                        "save_every": max(100, steps // 10),
                        "max_step_saves_to_keep": 4,
                    },
                    "datasets": [
                        {
                            "folder_path": dataset_path,
                            "caption_ext": "txt",
                            "caption_dropout_rate": 0.05,
                            "shuffle_tokens": False,
                            "cache_latents_to_disk": True,
                            "resolution": [resolution],
                        }
                    ],
                    "train": {
                        "batch_size": 1,
                        "steps": steps,
                        "gradient_accumulation_steps": 1,
                        "train_unet": True,
                        "train_text_encoder": False,
                        "gradient_checkpointing": True,
                        "noise_scheduler": "flowmatch",
                        "optimizer": "adamw8bit",
                        "lr": lr,
                        "ema_config": {
                            "use_ema": True,
                            "ema_decay": 0.99,
                        },
                        "dtype": "bf16",
                    },
                    "model": {
                        "name_or_path": "black-forest-labs/FLUX.1-dev",
                        "is_flux": True,
                        "quantize": True,
                    },
                    "sample": {
                        "sampler": "flowmatch",
                        "sample_every": max(200, steps // 5),
                        "width": resolution,
                        "height": resolution,
                        "prompts": [
                            f"a photo of {trigger_word} person",
                        ],
                        "neg": "",
                        "seed": 42,
                        "walk_seed": True,
                        "guidance_scale": 4,
                        "sample_steps": 20,
                    },
                }
            ],
        },
        "meta": {
            "name": "[name]",
            "version": "1.0",
        },
    }
    return config


# ---------------------------------------------------------------------------
# Training monitor thread
# ---------------------------------------------------------------------------

_STEP_RE = re.compile(
    r"step[:\s]+(\d+).*?loss[:\s]+([\d.eE+\-]+)(?:.*?(?:it/s|s/it)[:\s]+([\d.]+))?",
    re.IGNORECASE,
)
_STEP_RE_ALT = re.compile(
    r"(\d+)/\d+.*?loss=([\d.eE+\-]+)(?:.*?([\d.]+)\s*(?:it/s|s/it))?",
    re.IGNORECASE,
)


def _parse_step_line(line: str):
    """Return (step, loss, speed) tuple or None if not a step line."""
    m = _STEP_RE.search(line)
    if m:
        step = int(m.group(1))
        loss = float(m.group(2))
        speed = float(m.group(3)) if m.group(3) else 0.0
        return step, loss, speed

    m = _STEP_RE_ALT.search(line)
    if m:
        step = int(m.group(1))
        loss = float(m.group(2))
        speed = float(m.group(3)) if m.group(3) else 0.0
        return step, loss, speed

    return None


def _monitor_training(job_id: str, process: subprocess.Popen, output_dir: str, total_steps: int):
    """Background thread: reads ai-toolkit stdout and updates the job registry."""
    try:
        for raw_line in process.stdout:
            line = raw_line.rstrip("\n")
            with _jobs_lock:
                job = _jobs.get(job_id)
                if job is None:
                    break
                job["log_lines"].append(line)

                parsed = _parse_step_line(line)
                if parsed:
                    step, loss, speed = parsed
                    job["steps"].append({"step": step, "loss": loss, "speed": speed})

                # Check if cancel was requested
                if job["cancel"].is_set():
                    try:
                        process.send_signal(signal.SIGTERM)
                    except Exception:
                        pass
                    break

        process.wait()
        return_code = process.returncode

        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is None:
                return

            if job["cancel"].is_set():
                job["status"] = "cancelled"
                return

            if return_code == 0:
                # Find the output .safetensors file
                output_path = _find_output_lora(output_dir)
                job["status"] = "completed"
                job["output"] = output_path
            else:
                job["status"] = "error"
                job["error"] = f"ai-toolkit exited with code {return_code}"

    except Exception as exc:
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job:
                job["status"] = "error"
                job["error"] = str(exc)


def _find_output_lora(output_dir: str):
    """Return path to the most recently modified .safetensors in output_dir."""
    candidates = list(Path(output_dir).rglob("*.safetensors"))
    if not candidates:
        return None
    return str(max(candidates, key=lambda p: p.stat().st_mtime))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/train", methods=["POST"])
def start_training():
    """
    POST /train
    Body: { datasetId, outputName, triggerWord, steps, lr, rank, resolution }
    Returns: { jobId }
    """
    params = request.get_json(force=True) or {}

    required = ["datasetId", "outputName"]
    missing = [k for k in required if not params.get(k)]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    job_id = str(uuid.uuid4())
    output_dir = str(Path.home() / ".flowscale" / "lora-outputs" / job_id)
    os.makedirs(output_dir, exist_ok=True)

    # Write YAML config to a temp file
    config_dict = _build_aitoolkit_config(params, output_dir)
    config_path = os.path.join(output_dir, "train_config.yaml")
    with open(config_path, "w") as f:
        yaml.dump(config_dict, f, default_flow_style=False)

    # Spawn ai-toolkit training process
    try:
        process = subprocess.Popen(
            ["python", "-m", "ai_toolkit.run", config_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        # Try alternate entry point
        try:
            process = subprocess.Popen(
                ["python", "run.py", config_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                cwd=os.environ.get("AI_TOOLKIT_DIR", "."),
            )
        except FileNotFoundError:
            return jsonify({"error": "ai-toolkit not found. Ensure it is installed and accessible."}), 500

    cancel_event = threading.Event()
    total_steps = int(params.get("steps", 1000))

    with _jobs_lock:
        _jobs[job_id] = {
            "status": "running",
            "process": process,
            "cancel": cancel_event,
            "log_lines": [],
            "steps": [],
            "output": None,
            "error": None,
            "total_steps": total_steps,
        }

    monitor_thread = threading.Thread(
        target=_monitor_training,
        args=(job_id, process, output_dir, total_steps),
        daemon=True,
    )
    monitor_thread.start()

    return jsonify({"jobId": job_id})


@app.route("/train/<job_id>/progress", methods=["GET"])
def training_progress(job_id: str):
    """
    GET /train/{jobId}/progress
    SSE stream: each event is a JSON object with step/loss/speed/status fields.
    """
    def generate():
        sent_step_index = 0
        while True:
            with _jobs_lock:
                job = _jobs.get(job_id)
                if job is None:
                    yield f"data: {json.dumps({'error': 'Job not found'})}\n\n"
                    return

                status = job["status"]
                total_steps = job.get("total_steps", 1)
                steps_data = job["steps"]
                new_steps = steps_data[sent_step_index:]

            for step_entry in new_steps:
                sent_step_index += 1
                progress_pct = round(step_entry["step"] / total_steps * 100, 1) if total_steps > 0 else 0
                payload = {
                    "step": step_entry["step"],
                    "totalSteps": total_steps,
                    "progress": progress_pct,
                    "loss": step_entry["loss"],
                    "speed": step_entry["speed"],
                    "status": "running",
                }
                yield f"data: {json.dumps(payload)}\n\n"

            if status in ("completed", "error", "cancelled"):
                with _jobs_lock:
                    job = _jobs.get(job_id, {})
                final_payload = {
                    "status": status,
                    "output": job.get("output"),
                    "error": job.get("error"),
                }
                yield f"data: {json.dumps(final_payload)}\n\n"
                return

            time.sleep(1.0)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/train/<job_id>/cancel", methods=["POST"])
def cancel_training(job_id: str):
    """
    POST /train/{jobId}/cancel
    Sets cancel flag and sends SIGTERM to the subprocess.
    """
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return jsonify({"error": "Job not found"}), 404

        if job["status"] != "running":
            return jsonify({"error": f"Job is not running (status: {job['status']})"}), 400

        job["cancel"].set()
        process = job["process"]

    if process and process.poll() is None:
        try:
            process.send_signal(signal.SIGTERM)
        except Exception:
            pass

    return jsonify({"jobId": job_id, "status": "cancelling"})


@app.route("/generate", methods=["POST"])
def generate():
    """
    POST /generate
    Standard plugin interface — captions a single image.
    Body: { image_b64?: string, image_path?: string, mode?: string }
    Returns: { caption: string }
    """
    body = request.get_json(force=True) or {}
    image_b64 = body.get("image_b64") or body.get("inputs", {}).get("image_b64")
    image_path = body.get("image_path") or body.get("inputs", {}).get("image_path")
    mode = body.get("mode", "detailed")

    if not image_b64 and not image_path:
        return jsonify({"error": "Provide image_b64 or image_path"}), 400

    try:
        caption = captioner.caption_image(
            image_path=image_path,
            image_b64=image_b64,
            mode=mode,
        )
        return jsonify({"caption": caption})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/caption/batch", methods=["POST"])
def caption_batch():
    """
    POST /caption/batch
    Batch image captioning with SSE progress stream.
    Body: { images: [{image_b64?, image_path?, id?}], mode?: string }
    SSE events: { id, index, total, caption?, error? }
    """
    body = request.get_json(force=True) or {}
    images = body.get("images", [])
    mode = body.get("mode", "detailed")

    if not images:
        return jsonify({"error": "No images provided"}), 400

    def generate():
        total = len(images)
        for i, item in enumerate(images):
            image_b64 = item.get("image_b64")
            image_path = item.get("image_path")
            item_id = item.get("id", str(i))

            try:
                caption = captioner.caption_image(
                    image_path=image_path,
                    image_b64=image_b64,
                    mode=mode,
                )
                payload = {
                    "id": item_id,
                    "index": i,
                    "total": total,
                    "caption": caption,
                }
            except Exception as exc:
                payload = {
                    "id": item_id,
                    "index": i,
                    "total": total,
                    "error": str(exc),
                }

            yield f"data: {json.dumps(payload)}\n\n"

        yield f"data: {json.dumps({'done': True, 'total': total})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 41300))
    print(f"[flux-lora-trainer] Starting server on port {port}")
    app.run(host="0.0.0.0", port=port, threaded=True)
