"""
Qwen-Image-Edit — Modal.com deployment.

Deploy once:
    modal deploy scripts/qwen_image_edit_modal.py

The endpoint follows the FlowScale AIOS Modal contract:
    POST /generate
        body:  { "inputs": { "api__prompt": "...", "api__image": "<base64>", ... }, "seed": 42 }
        reply: { "outputs": [{ "kind": "image", "filename": "output.png", "data": "<base64>" }] }

Supports optional mask-based inpainting:
    Pass "api__mask_image" (base64 PNG, white=repaint black=preserve) and
    "api__strength" (0.0–1.0) to selectively edit masked regions.
    When no mask is provided, the full image is edited normally.

Optional auth: set a Modal secret named "flowscale-modal-key" with key MODAL_API_KEY.
When set, every request must include  Authorization: Bearer <MODAL_API_KEY>.

GET /health returns { "status": "ok", "model": "Qwen/Qwen-Image-Edit" }.
"""

from __future__ import annotations

import base64
import os
from io import BytesIO

import modal

# ── Constants ────────────────────────────────────────────────────────────────
MODEL_REPO = "Qwen/Qwen-Image-Edit"
MODEL_DIR = "/weights"

# ── Volume ───────────────────────────────────────────────────────────────────
model_volume = modal.Volume.from_name("qwen-image-edit-weights", create_if_missing=True)

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
app = modal.App("qwen-image-edit", image=image)

_secrets: list = [modal.Secret.from_name("huggingface")]
# Uncomment after creating the Modal secret for auth:
# _secrets.append(modal.Secret.from_name("flowscale-modal-key"))


# ── Model class ───────────────────────────────────────────────────────────────

@app.cls(
    gpu="A100-80GB",
    volumes={MODEL_DIR: model_volume},
    secrets=_secrets,
    scaledown_window=60,
    timeout=600,
)
class QwenImageEdit:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import QwenImageEditPipeline, QwenImageEditInpaintPipeline
        from huggingface_hub import snapshot_download

        model_path = os.path.join(MODEL_DIR, "qwen-image-edit")
        if not os.path.exists(model_path) or not os.listdir(model_path):
            print("Downloading Qwen-Image-Edit weights...")
            snapshot_download(repo_id=MODEL_REPO, local_dir=model_path)
            model_volume.commit()

        # Load the regular edit pipeline
        self.pipe = QwenImageEditPipeline.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
        ).to("cuda")

        # Create inpaint pipeline sharing the same model components (no extra GPU memory)
        self.inpaint_pipe = QwenImageEditInpaintPipeline(
            transformer=self.pipe.transformer,
            vae=self.pipe.vae,
            text_encoder=self.pipe.text_encoder,
            tokenizer=self.pipe.tokenizer,
            processor=self.pipe.processor,
            scheduler=self.pipe.scheduler,
        ).to("cuda")
        print("Both edit and inpaint pipelines ready.")

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
        from PIL import Image

        if not self._auth(authorization):
            raise HTTPException(status_code=401, detail="Unauthorized")

        raw_inputs: dict = request.get("inputs", {})
        seed: int = int(request.get("seed", -1))

        def _get(key: str, default=None):
            return raw_inputs.get(f"api__{key}", raw_inputs.get(key, default))

        prompt: str = str(_get("prompt", ""))
        negative_prompt: str = str(_get("negative_prompt", " "))
        steps: int = int(_get("num_inference_steps", 50))
        true_cfg: float = float(_get("true_cfg_scale", 4.0))

        # Decode input image from base64 (may include data URL prefix)
        image_data: str = str(_get("image", ""))
        if not image_data:
            raise HTTPException(status_code=400, detail="Input image is required")
        if "," in image_data:
            image_data = image_data.split(",", 1)[-1]
        input_image = Image.open(BytesIO(base64.b64decode(image_data))).convert("RGB")

        # Optional mask for inpainting (white=repaint, black=preserve)
        mask_data: str = str(_get("mask_image", ""))
        mask_image = None
        if mask_data:
            if "," in mask_data:
                mask_data = mask_data.split(",", 1)[-1]
            mask_image = Image.open(BytesIO(base64.b64decode(mask_data))).convert("L")

        strength: float = float(_get("strength", 1.0))
        generator = torch.Generator("cuda").manual_seed(seed) if seed >= 0 else None

        with torch.inference_mode():
            if mask_image is not None:
                # Inpaint mode — only repaint masked (white) regions
                result = self.inpaint_pipe(
                    image=input_image,
                    mask_image=mask_image,
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    num_inference_steps=steps,
                    true_cfg_scale=true_cfg,
                    strength=strength,
                    generator=generator,
                ).images[0]
            else:
                # Regular edit mode — edit the full image
                result = self.pipe(
                    image=input_image,
                    prompt=prompt,
                    negative_prompt=negative_prompt,
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
