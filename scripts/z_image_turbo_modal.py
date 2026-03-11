"""
Z-Image Turbo — Modal.com deployment.

Deploy once:
    modal deploy scripts/z_image_turbo_modal.py

The endpoint follows the FlowScale AIOS Modal contract:
    POST /generate
        body:  { "inputs": { "api__prompt": "...", ... }, "seed": 42 }
        reply: { "outputs": [{ "kind": "image", "filename": "output.png", "data": "<base64>" }] }

Optional auth: set a Modal secret named "flowscale-modal-key" with key MODAL_API_KEY.
When set, every request must include  Authorization: Bearer <MODAL_API_KEY>.

GET /health returns { "status": "ok", "model": "Tongyi-MAI/Z-Image-Turbo" }.
"""

import base64
import os
from io import BytesIO

import modal

# ── Image ─────────────────────────────────────────────────────────────────────

def _download_model():
    """Bake model weights into the image layer for fast cold starts."""
    from diffusers import DiffusionPipeline
    import torch
    DiffusionPipeline.from_pretrained(
        "Tongyi-MAI/Z-Image-Turbo",
        torch_dtype=torch.bfloat16,
    )


image = (
    modal.Image.debian_slim(python_version="3.11")
    .env({
        # Disable hf-xet (Rust downloader) — causes panics on some Modal hosts
        "HF_HUB_ENABLE_XET": "0",
        "HF_HUB_ENABLE_HF_TRANSFER": "0",
        "HF_HUB_DOWNLOAD_WORKERS": "1",
        "HF_HUB_DISABLE_PROGRESS_BARS": "1",
        "TQDM_DISABLE": "1",
    })
    .pip_install(
        "torch==2.5.1",
        "torchvision",
        "diffusers>=0.29.0",
        "transformers>=4.40.0",
        "accelerate>=0.30.0",
        "pillow",
        "fastapi[standard]",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    # Download weights at build time — they're baked into the image layer
    # and served from local disk on the worker, not over the network.
    # This brings cold start from ~41s (volume read) down to ~10–15s.
    .run_function(_download_model)
)

# ── App ───────────────────────────────────────────────────────────────────────

app = modal.App("z-image-turbo", image=image)

# Optional secret for request authentication.
# To enable: modal secret create flowscale-modal-key MODAL_API_KEY=<your-token>
# Then set FLOWSCALE_MODAL_AUTH=1 below so the app includes the secret in the cls.
# If you don't need auth, leave _secrets empty (endpoint is publicly accessible).
_secrets: list = []
# Uncomment the line below after creating the Modal secret:
# _secrets = [modal.Secret.from_name("flowscale-modal-key")]


# ── Model class ───────────────────────────────────────────────────────────────

@app.cls(
    gpu="A10G",
    secrets=_secrets,
    scaledown_window=60,          # keep warm 1 min after last request
    timeout=600,                  # max 10 min per generation request
)
class ZImageTurbo:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import DiffusionPipeline

        model_id = "Tongyi-MAI/Z-Image-Turbo"
        # Weights were baked into the image layer at build time — load from local disk, no network.
        self.pipe = DiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16,
        ).to("cuda")

    def _auth(self, authorization: str | None) -> bool:
        expected = os.environ.get("MODAL_API_KEY")
        if not expected:
            return True   # no secret configured — open access
        if not authorization:
            return False
        parts = authorization.split(" ", 1)
        return len(parts) == 2 and parts[0].lower() == "bearer" and parts[1] == expected

    @modal.fastapi_endpoint(method="GET")
    def health(self):
        from fastapi.responses import JSONResponse
        return JSONResponse({"status": "ok", "model": "Tongyi-MAI/Z-Image-Turbo"})

    @modal.fastapi_endpoint(method="POST")
    def generate(self, request: dict, authorization: str | None = None):
        import torch
        from fastapi import HTTPException
        from fastapi.responses import JSONResponse

        if not self._auth(authorization):
            raise HTTPException(status_code=401, detail="Unauthorized")

        # ── Parse inputs ──────────────────────────────────────────────────────
        # Strip the "api__" node-id prefix used by the FlowScale schema convention.
        raw_inputs: dict = request.get("inputs", {})
        seed: int = int(request.get("seed", -1))

        def _get(key: str, default=None):
            return raw_inputs.get(f"api__{key}", raw_inputs.get(key, default))

        prompt: str = str(_get("prompt", ""))
        negative_prompt: str = str(_get("negative_prompt", ""))
        width: int = int(_get("width", 1024))
        height: int = int(_get("height", 1024))
        steps: int = int(_get("num_inference_steps", 4))
        guidance: float = float(_get("guidance_scale", 0.0))

        # ── Inference ─────────────────────────────────────────────────────────
        generator = torch.Generator("cuda").manual_seed(seed) if seed >= 0 else None
        image = self.pipe(
            prompt=prompt,
            negative_prompt=negative_prompt or None,
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=guidance,
            generator=generator,
        ).images[0]

        buf = BytesIO()
        image.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()

        return JSONResponse({
            "outputs": [
                {"kind": "image", "filename": "output.png", "data": b64}
            ]
        })
