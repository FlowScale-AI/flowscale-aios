"""
LTX-2.3 Video — Modal.com deployment.

Deploy once:
    modal deploy scripts/ltx_video_modal.py

The endpoint follows the FlowScale AIOS Modal contract:
    POST /generate
        body:  { "inputs": { "api__prompt": "...", ... }, "seed": 42 }
        reply: { "outputs": [{ "kind": "video", "filename": "output.mp4", "data": "<base64>" }] }

Optional auth: set a Modal secret named "flowscale-modal-key" with key MODAL_API_KEY.
When set, every request must include  Authorization: Bearer <MODAL_API_KEY>.

GET /health returns { "status": "ok", "model": "Lightricks/LTX-2.3" }.
"""

import base64
import os
import tempfile

import modal

# ── Constants ────────────────────────────────────────────────────────────────

MODEL_REPO = "Lightricks/LTX-2.3"
GEMMA_REPO = "google/gemma-3-12b-it-qat-q4_0-unquantized"
MODEL_DIR = "/weights"

# ── Volume ───────────────────────────────────────────────────────────────────
# 22B model (~46 GB) + Gemma encoder (~12 GB) — too large for image layer.
# A Modal Volume stores them on network-attached SSD, persistent across deploys.

model_volume = modal.Volume.from_name("ltx-video-weights", create_if_missing=True)

# ── Image ────────────────────────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.12")
    .env({
        "HF_HUB_ENABLE_XET": "0",
        "HF_HUB_ENABLE_HF_TRANSFER": "0",
        "HF_HUB_DOWNLOAD_WORKERS": "1",
        "HF_HUB_DISABLE_PROGRESS_BARS": "1",
        "TQDM_DISABLE": "1",
        "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
        "TRANSFORMERS_NO_ADVISORY_WARNINGS": "1",
    })
    .apt_install("git", "ffmpeg")
    .pip_install(
        "torch~=2.7",
        "torchaudio",
        "torchvision",
        "einops",
        "numpy",
        "transformers==4.57.6",
        "safetensors",
        "accelerate",
        "scipy>=1.14",
        "av",
        "tqdm",
        "pillow",
        "sentencepiece",
        "fastapi[standard]",
        extra_index_url="https://download.pytorch.org/whl/cu129",
    )
    # Install ltx-core and ltx-pipelines from the official repo
    .pip_install(
        "ltx-core @ git+https://github.com/Lightricks/LTX-2.git#subdirectory=packages/ltx-core",
        "ltx-pipelines @ git+https://github.com/Lightricks/LTX-2.git#subdirectory=packages/ltx-pipelines",
    )
)

# ── App ──────────────────────────────────────────────────────────────────────

app = modal.App("ltx-video", image=image)

_secrets: list = [modal.Secret.from_name("huggingface")]
# Uncomment after creating the Modal secret for auth:
# _secrets.append(modal.Secret.from_name("flowscale-modal-key"))


# ── Model class ──────────────────────────────────────────────────────────────

@app.cls(
    gpu="A100-80GB",
    volumes={MODEL_DIR: model_volume},
    secrets=_secrets,
    scaledown_window=120,       # keep warm 2 min (video gen is slow → reduce cold starts)
    timeout=1200,               # max 20 min per generation request
)
class LTXVideo:
    @modal.enter()
    def load(self):
        import torch
        from huggingface_hub import hf_hub_download, snapshot_download

        # ── Download model files if not already cached ───────────────────────
        checkpoint_path = os.path.join(MODEL_DIR, "ltx-2.3-22b-distilled.safetensors")
        upscaler_path = os.path.join(MODEL_DIR, "ltx-2.3-spatial-upscaler-x2-1.0.safetensors")
        gemma_dir = os.path.join(MODEL_DIR, "gemma")

        if not os.path.exists(checkpoint_path):
            print("Downloading LTX-2.3 distilled checkpoint...")
            hf_hub_download(
                repo_id=MODEL_REPO,
                filename="ltx-2.3-22b-distilled.safetensors",
                local_dir=MODEL_DIR,
            )

        if not os.path.exists(upscaler_path):
            print("Downloading spatial upscaler...")
            hf_hub_download(
                repo_id=MODEL_REPO,
                filename="ltx-2.3-spatial-upscaler-x2-1.0.safetensors",
                local_dir=MODEL_DIR,
            )

        if not os.path.isdir(gemma_dir) or not os.listdir(gemma_dir):
            print("Downloading Gemma text encoder...")
            snapshot_download(
                repo_id=GEMMA_REPO,
                local_dir=gemma_dir,
            )

        model_volume.commit()

        # ── Load pipeline with fp8 quantization ──────────────────────────────
        # IMPORTANT: The pipeline's __call__ does NOT use torch.inference_mode(),
        # so callers MUST wrap calls in torch.inference_mode() or ~37GB of grad
        # graphs leak (see https://github.com/Lightricks/LTX-2/issues/152).
        from ltx_pipelines.distilled import DistilledPipeline
        from ltx_core.quantization import QuantizationPolicy

        print("Initializing DistilledPipeline with fp8_cast quantization...")
        self.pipeline = DistilledPipeline(
            distilled_checkpoint_path=checkpoint_path,
            spatial_upsampler_path=upscaler_path,
            gemma_root=gemma_dir,
            loras=[],
            quantization=QuantizationPolicy.fp8_cast(),
        )
        print("Pipeline ready.")

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
        return JSONResponse({"status": "ok", "model": "Lightricks/LTX-2.3"})

    @modal.fastapi_endpoint(method="POST")
    def generate(self, request: dict, authorization: str | None = None):
        import torch
        from fastapi import HTTPException
        from fastapi.responses import JSONResponse

        if not self._auth(authorization):
            raise HTTPException(status_code=401, detail="Unauthorized")

        # ── Parse inputs ─────────────────────────────────────────────────────
        raw_inputs: dict = request.get("inputs", {})
        seed: int = int(request.get("seed", 42))

        def _get(key: str, default=None):
            return raw_inputs.get(f"api__{key}", raw_inputs.get(key, default))

        prompt: str = str(_get("prompt", ""))
        width: int = int(_get("width", 768))
        height: int = int(_get("height", 512))
        num_frames: int = int(_get("num_frames", 65))
        frame_rate: float = float(_get("frame_rate", 25.0))

        # Ensure dimensions are divisible by 32
        width = (width // 32) * 32
        height = (height // 32) * 32
        # Ensure frames are divisible by 8 + 1
        num_frames = ((num_frames - 1) // 8) * 8 + 1

        # ── Inference ────────────────────────────────────────────────────────
        # inference_mode() is CRITICAL — without it the Gemma text encoder
        # leaks ~37 GB of grad graphs (LTX-2 issue #152).
        print(f"Generating video: {width}x{height}, {num_frames} frames, seed={seed}")
        print(f"Prompt: {prompt[:100]}...")

        with torch.inference_mode():
            video_iter, audio = self.pipeline(
                prompt=prompt,
                seed=seed,
                height=height,
                width=width,
                num_frames=num_frames,
                frame_rate=frame_rate,
                images=[],          # text-to-video — no conditioning images
            )

            # ── Encode to MP4 ────────────────────────────────────────────────
            # encode_video expects an iterator (not a list) and video_chunks_number
            from ltx_pipelines.utils.media_io import encode_video

            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name

            encode_video(video_iter, int(frame_rate), audio, tmp_path, video_chunks_number=1)

        with open(tmp_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()

        os.unlink(tmp_path)

        return JSONResponse({
            "outputs": [
                {"kind": "video", "filename": "output.mp4", "data": b64}
            ]
        })
