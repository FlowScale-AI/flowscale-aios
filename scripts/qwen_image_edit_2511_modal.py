"""
Qwen-Image-Edit-2511 — Modal.com deployment.

Deploy once:
    modal deploy scripts/qwen_image_edit_2511_modal.py

The endpoint follows the FlowScale AIOS Modal contract:
    POST /generate
        body:  { "inputs": { "api__prompt": "...", "api__image": "<base64>", ... }, "seed": 42 }
        reply: { "outputs": [{ "kind": "image", "filename": "output.png", "data": "<base64>" }] }

Supports optional mask-based editing:
    Pass "api__mask_image" (base64 PNG, white=repaint black=preserve) and
    "api__strength" (0.0–1.0) to selectively apply edits to masked regions.
    When no mask is provided, the full image is edited normally.
    (Uses post-processing blend since the Plus pipeline has no native inpaint variant.)

Optional auth: set a Modal secret named "flowscale-modal-key" with key MODAL_API_KEY.
When set, every request must include  Authorization: Bearer <MODAL_API_KEY>.

GET /health returns { "status": "ok", "model": "Qwen/Qwen-Image-Edit-2511" }.
"""

from __future__ import annotations

import base64
import os
from io import BytesIO

import modal

# ── Constants ────────────────────────────────────────────────────────────────
MODEL_REPO = "Qwen/Qwen-Image-Edit-2511"
MODEL_DIR = "/weights"

# ── Volume ───────────────────────────────────────────────────────────────────
model_volume = modal.Volume.from_name("qwen-image-edit-2511-weights", create_if_missing=True)

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
        "numpy",
        "fastapi[standard]",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
)

# ── App ───────────────────────────────────────────────────────────────────────
app = modal.App("qwen-image-edit-2511", image=image)

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
class QwenImageEdit2511:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import QwenImageEditPlusPipeline
        from huggingface_hub import snapshot_download

        model_path = os.path.join(MODEL_DIR, "qwen-image-edit-2511")
        if not os.path.exists(model_path) or not os.listdir(model_path):
            print("Downloading Qwen-Image-Edit-2511 weights...")
            snapshot_download(repo_id=MODEL_REPO, local_dir=model_path)
            model_volume.commit()

        self.pipe = QwenImageEditPlusPipeline.from_pretrained(
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
        import numpy as np
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
        steps: int = int(_get("num_inference_steps", 40))
        guidance: float = float(_get("guidance_scale", 1.0))
        true_cfg: float = float(_get("true_cfg_scale", 4.0))

        # Decode input image from base64 (may include data URL prefix)
        image_data: str = str(_get("image", ""))
        if not image_data:
            raise HTTPException(status_code=400, detail="Input image is required")
        if "," in image_data:
            image_data = image_data.split(",", 1)[-1]
        input_image = Image.open(BytesIO(base64.b64decode(image_data))).convert("RGB")

        # Optional mask for selective editing (white=repaint, black=preserve)
        mask_data: str = str(_get("mask_image", ""))
        mask_image = None
        if mask_data:
            if "," in mask_data:
                mask_data = mask_data.split(",", 1)[-1]
            mask_image = Image.open(BytesIO(base64.b64decode(mask_data))).convert("L")

        strength: float = float(_get("strength", 1.0))
        generator = torch.Generator("cuda").manual_seed(seed) if seed >= 0 else None

        with torch.inference_mode():
            edited = self.pipe(
                image=[input_image],
                prompt=prompt,
                negative_prompt=negative_prompt,
                num_inference_steps=steps,
                guidance_scale=guidance,
                true_cfg_scale=true_cfg,
                num_images_per_prompt=1,
                generator=generator,
            ).images[0]

        # If mask provided, blend: keep original in black regions, use edit in white regions
        if mask_image is not None:
            # Resize mask to match output dimensions
            mask_resized = mask_image.resize(edited.size, Image.LANCZOS)
            # Normalize mask to 0-1 and apply strength
            mask_arr = np.array(mask_resized, dtype=np.float32) / 255.0 * strength
            mask_arr = mask_arr[:, :, np.newaxis]  # (H, W, 1) for broadcasting

            # Resize original to match output if needed
            original_resized = input_image.resize(edited.size, Image.LANCZOS)

            # Blend: mask=1 → edited, mask=0 → original
            orig_arr = np.array(original_resized, dtype=np.float32)
            edit_arr = np.array(edited, dtype=np.float32)
            blended = (mask_arr * edit_arr + (1.0 - mask_arr) * orig_arr)
            result = Image.fromarray(np.clip(blended, 0, 255).astype(np.uint8))
        else:
            result = edited

        buf = BytesIO()
        result.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()

        return JSONResponse({
            "outputs": [
                {"kind": "image", "filename": "output.png", "data": b64}
            ]
        })
