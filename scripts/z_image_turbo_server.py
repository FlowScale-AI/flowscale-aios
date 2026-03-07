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
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

app = FastAPI()
pipe = None
_executor = ThreadPoolExecutor(max_workers=1)


class GenerateRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    num_inference_steps: int = 4
    guidance_scale: float = 0.0
    seed: int = -1


@app.on_event("startup")
async def load_model():
    global pipe
    import torch
    from diffusers import DiffusionPipeline

    print("Loading Tongyi-MAI/Z-Image-Turbo…", flush=True)
    pipe = DiffusionPipeline.from_pretrained(
        "Tongyi-MAI/Z-Image-Turbo",
        torch_dtype=torch.bfloat16,
    )

    if torch.cuda.is_available():
        try:
            pipe = pipe.to("cuda")
            print("Using CUDA.")
        except torch.OutOfMemoryError:
            print("GPU OOM — moving model back to CPU then enabling sequential CPU offload.")
            torch.cuda.empty_cache()
            pipe.to("cpu")
            torch.cuda.empty_cache()
            pipe.enable_sequential_cpu_offload()
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        pipe = pipe.to("mps")
        print("Using MPS (Apple Silicon).")
    else:
        pipe = pipe.to("cpu")
        print("Warning: running on CPU — inference will be slow.")

    print("Model ready.")


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": pipe is not None}


def _run_inference(req: GenerateRequest) -> str:
    """Blocking inference — runs in a thread so the event loop stays responsive."""
    import torch

    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    generator = torch.Generator().manual_seed(req.seed) if req.seed >= 0 else None
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

    uvicorn.run(app, host="127.0.0.1", port=args.port)
