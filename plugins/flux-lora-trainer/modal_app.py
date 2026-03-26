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
            # Match tqdm format "N/M" (e.g. "9/100") or "step: N" / "step N"
            match = re.search(r"(\d+)/(\d+)\s*\[", line) or re.search(r"step[:\s]+(\d+)", line, re.IGNORECASE)
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

        # Return path relative to volume root (strip /outputs/ mount prefix)
        output_volume_path = str(lora_path)
        if output_volume_path.startswith("/outputs/"):
            output_volume_path = output_volume_path[len("/outputs/"):]
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
