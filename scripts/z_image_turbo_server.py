#!/usr/bin/env python3
"""
Z-Image Turbo local inference server.

Requirements:
    pip install diffusers transformers torch accelerate fastapi uvicorn pillow

Usage:
    python scripts/z_image_turbo_server.py [--port 8765]

The server loads the Tongyi-MAI/Z-Image-Turbo model once on startup and
handles generation requests from the FlowScale AIOS app.
"""
import argparse
import asyncio
import base64
import os
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

# Force single-threaded HF downloads — parallel downloads hang on macOS system
# Python (LibreSSL + urllib3 v2 incompatibility)
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")
os.environ.setdefault("HF_HUB_DOWNLOAD_WORKERS", "1")
# Disable hf-xet (Rust downloader) — it hangs on macOS. Use classic HTTP instead.
os.environ["HF_HUB_ENABLE_XET"] = "0"
# Disable tqdm progress bars — they use ANSI escapes that break our log capture.
# We print plain-text progress from a monitor thread instead.
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["TQDM_DISABLE"] = "1"
# Allow MPS to use all available unified memory instead of hard-crashing at ~75%.
# Without this, large models OOM on 24GB Macs at 1024x1024.
os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

app = FastAPI()
pipe = None
_current_device: str = "cpu"
_executor = ThreadPoolExecutor(max_workers=1)


class GenerateRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    num_inference_steps: int = 4
    guidance_scale: float = 0.0
    seed: int = -1
    device: str = ""


def _download_model(model_id: str):
    """Download model files one at a time with plain-text progress."""
    from huggingface_hub import hf_hub_download, model_info
    import time

    print(f"Checking model files for {model_id}…", flush=True)
    try:
        info = model_info(model_id, files_metadata=True)
        files = [(s.rfilename, s.size or 0) for s in info.siblings]
        total_size = sum(sz for _, sz in files)
        print(f"Model: {len(files)} files, {total_size / 1e9:.1f} GB total", flush=True)
    except Exception as e:
        print(f"Warning: could not fetch model info: {e}", flush=True)
        # Fall back to snapshot_download
        from huggingface_hub import snapshot_download
        return snapshot_download(model_id, max_workers=1)

    # Download each file sequentially — avoids parallel connection hangs
    import threading
    import glob

    blob_dir = os.path.expanduser(
        f"~/.cache/huggingface/hub/models--{model_id.replace('/', '--')}/blobs"
    )

    def _progress_bar(current, total, width=30):
        """Render a tqdm-style bar. Contains %| so appendLog updates it in-place."""
        pct = current / total * 100 if total else 0
        filled = int(width * current / total) if total else 0
        bar = "█" * filled + "░" * (width - filled)
        return f"  {pct:5.1f}%|{bar}| {current / 1e9:.2f}/{total / 1e9:.2f} GB"

    downloaded = 0
    start = time.time()
    for i, (fname, fsize) in enumerate(files, 1):
        label = fname.split("/")[-1]
        print(f"[{i}/{len(files)}] {label} ({fsize / 1e9:.2f} GB)", flush=True)

        # For large files, monitor .incomplete file growth every 3s
        stop_monitor = threading.Event()
        if fsize > 50_000_000:  # > 50MB
            def _monitor(target=fsize, bdir=blob_dir):
                while not stop_monitor.is_set():
                    stop_monitor.wait(3)
                    if stop_monitor.is_set():
                        break
                    # Find the largest .incomplete file — that's the active download
                    current = 0
                    try:
                        for f in os.listdir(bdir):
                            if f.endswith(".incomplete"):
                                sz = os.path.getsize(os.path.join(bdir, f))
                                if sz > current:
                                    current = sz
                    except OSError:
                        pass
                    if current > 0:
                        print(_progress_bar(min(current, target), target), flush=True)
            mon = threading.Thread(target=_monitor, daemon=True)
            mon.start()

        t0 = time.time()
        hf_hub_download(model_id, fname)
        dt = time.time() - t0

        stop_monitor.set()
        downloaded += fsize
        total_pct = downloaded / total_size * 100 if total_size else 0
        if dt > 1:
            speed = fsize / 1e6 / dt
            # Print completed bar then summary
            print(_progress_bar(fsize, fsize), flush=True)
            print(f"  ✓ {dt:.0f}s ({speed:.1f} MB/s) — overall {total_pct:.0f}%", flush=True)
        else:
            print(f"  ✓ cached — overall {total_pct:.0f}%", flush=True)

    elapsed = time.time() - start
    print(f"All files ready in {elapsed:.0f}s.", flush=True)

    # Return the snapshot path
    from huggingface_hub import snapshot_download
    return snapshot_download(model_id, local_files_only=True)


def _resolve_device(requested: str) -> str:
    """Resolve a device string to a valid torch device.

    Accepts: 'cpu', 'cuda', 'cuda:N', 'rocm:N' (mapped to cuda:N with
    HIP_VISIBLE_DEVICES), 'mps', or '' (auto-detect best available).
    """
    import torch

    if requested == "cpu":
        return "cpu"
    if requested.startswith("rocm:"):
        # ROCm uses the CUDA API under HIP — map rocm:N to cuda:N
        return "cuda:" + requested.split(":")[1]
    if requested.startswith("cuda"):
        return requested
    if requested == "mps":
        return "mps"
    # Auto-detect
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _move_pipe_to(device: str):
    """Move the pipeline to the given device, updating _current_device."""
    global pipe, _current_device
    import torch

    if _current_device == device:
        return

    target = device
    print(f"Moving model from {_current_device} to {target}…", flush=True)

    try:
        pipe = pipe.to(target)
        _current_device = device
        print(f"Model now on {device}.", flush=True)
    except torch.OutOfMemoryError:
        print(f"GPU OOM on {device} — enabling sequential CPU offload.", flush=True)
        if "cuda" in device:
            torch.cuda.empty_cache()
        pipe.enable_sequential_cpu_offload()
        _current_device = device


@app.on_event("startup")
async def load_model():
    global pipe
    import torch
    from diffusers import DiffusionPipeline

    use_mps = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
    # float16 causes NaN outputs on MPS (Apple Silicon) for large diffusion models
    # due to numerical overflow in attention layers. Use float32 on MPS instead.
    dtype = torch.float32 if use_mps else torch.bfloat16

    model_id = "Tongyi-MAI/Z-Image-Turbo"
    print(f"Loading {model_id}…", flush=True)

    # Download with progress first, then load from cache
    _download_model(model_id)
    print("Loading model into memory (CPU)…", flush=True)
    pipe = DiffusionPipeline.from_pretrained(
        model_id,
        torch_dtype=dtype,
        local_files_only=True,
    )
    # Keep on CPU — the /generate endpoint moves to the requested device lazily
    print("Model ready (on CPU). Will move to GPU on first generate request.")


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": pipe is not None, "current_device": _current_device}


def _run_inference(req: GenerateRequest) -> str:
    """Blocking inference — runs in a thread so the event loop stays responsive."""
    import torch

    # Move model to requested device (no-op if already there)
    target = _resolve_device(req.device)
    _move_pipe_to(target)

    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        torch.mps.empty_cache()

    gen_device = "cpu" if target == "cpu" else target
    generator = torch.Generator(gen_device).manual_seed(req.seed) if req.seed >= 0 else None
    image = pipe(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt or None,
        width=req.width,
        height=req.height,
        num_inference_steps=req.num_inference_steps,
        guidance_scale=req.guidance_scale,
        generator=generator,
    ).images[0]
    buf = BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@app.post("/generate")
async def generate(req: GenerateRequest):
    if pipe is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    loop = asyncio.get_event_loop()
    image_b64 = await loop.run_in_executor(_executor, lambda: _run_inference(req))
    return {"image": image_b64}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Z-Image Turbo local inference server")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on (default: 8765)")
    args = parser.parse_args()

    # Configure logging to filter out /health spam
    import logging

    class HealthFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            msg = record.getMessage()
            return not ("/health" in msg and "200" in msg)

    logging.getLogger("uvicorn.access").addFilter(HealthFilter())

    uvicorn.run(app, host="127.0.0.1", port=args.port)
