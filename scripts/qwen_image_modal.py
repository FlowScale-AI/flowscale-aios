"""
Qwen-Image — Modal.com deployment.

Deploy once:
    modal deploy scripts/qwen_image_modal.py

The endpoint follows the FlowScale AIOS Modal contract:
    POST /generate
        body:  { "inputs": { "api__prompt": "...", ... }, "seed": 42 }
        reply: { "outputs": [{ "kind": "image", "filename": "output.png", "data": "<base64>" }] }

Optional auth: set a Modal secret named "flowscale-modal-key" with key MODAL_API_KEY.
When set, every request must include  Authorization: Bearer <MODAL_API_KEY>.

GET /health returns { "status": "ok", "model": "Qwen/Qwen-Image" }.
"""

from __future__ import annotations

import base64
import os
from io import BytesIO

import modal

# ── Constants ────────────────────────────────────────────────────────────────
MODEL_REPO = "Qwen/Qwen-Image"
MODEL_DIR = "/weights"

# ── Volume ───────────────────────────────────────────────────────────────────
model_volume = modal.Volume.from_name("qwen-image-weights", create_if_missing=True)

# ── Image ─────────────────────────────────────────────────────────────────────
image = (
    modal.Image.debian_slim(python_version="3.11")
    .env({
        "HF_HUB_ENABLE_XET": "0",
        "HF_HUB_ENABLE_HF_TRANSFER": "0",
        "HF_HUB_DOWNLOAD_WORKERS": "1",
        "HF_HUB_DISABLE_PROGRESS_BARS": "1",
        "TQDM_DISABLE": "1",
    })
    .apt_install("git")
    .pip_install(
        "torch==2.5.1",
        "torchvision",
        "diffusers @ git+https://github.com/huggingface/diffusers",
        "transformers>=4.51.0",
        "accelerate>=0.30.0",
        "pillow",
        "fastapi[standard]",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
)

# ── App ───────────────────────────────────────────────────────────────────────
app = modal.App("qwen-image", image=image)

_secrets: list = [modal.Secret.from_name("huggingface")]
# Uncomment after creating the Modal secret for auth:
# _secrets.append(modal.Secret.from_name("flowscale-modal-key"))


# ── Model class ───────────────────────────────────────────────────────────────

@app.cls(
    gpu="A10G",
    volumes={MODEL_DIR: model_volume},
    secrets=_secrets,
    scaledown_window=60,
    timeout=600,
)
class QwenImage:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import DiffusionPipeline
        from huggingface_hub import snapshot_download

        model_path = os.path.join(MODEL_DIR, "qwen-image")
        if not os.path.exists(model_path) or not os.listdir(model_path):
            print("Downloading Qwen-Image weights...")
            snapshot_download(repo_id=MODEL_REPO, local_dir=model_path)
            model_volume.commit()

        self.pipe = DiffusionPipeline.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
        ).to("cuda")

    def _auth(self, authorization: str | None) -> bool:
        expected = os.environ.get("MODAL_API_KEY")
        if not expected:
            return True
        if not authorization:
            return False
        parts = authorization.split(" ", 1)
        return len(parts) == 2 and parts[0].lower() == "bearer" and parts[1] == expected

    @modal.fastapi_endpoint(method="GET")
    def health(self):
        from fastapi.responses import JSONResponse
        return JSONResponse({"status": "ok", "model": MODEL_REPO})

    @modal.fastapi_endpoint(method="POST")
    def generate(self, request: dict, authorization: str | None = None):
        import torch
        from fastapi import HTTPException
        from fastapi.responses import JSONResponse

        if not self._auth(authorization):
            raise HTTPException(status_code=401, detail="Unauthorized")

        raw_inputs: dict = request.get("inputs", {})
        seed: int = int(request.get("seed", -1))

        def _get(key: str, default=None):
            return raw_inputs.get(f"api__{key}", raw_inputs.get(key, default))

        prompt: str = str(_get("prompt", ""))
        negative_prompt: str = str(_get("negative_prompt", " "))
        width: int = int(_get("width", 1328))
        height: int = int(_get("height", 1328))
        steps: int = int(_get("num_inference_steps", 50))
        true_cfg: float = float(_get("true_cfg_scale", 4.0))

        generator = torch.Generator("cuda").manual_seed(seed) if seed >= 0 else None
        result = self.pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_inference_steps=steps,
            true_cfg_scale=true_cfg,
            generator=generator,
        ).images[0]

        buf = BytesIO()
        result.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()

        return JSONResponse({
            "outputs": [
                {"kind": "image", "filename": "output.png", "data": b64}
            ]
        })
