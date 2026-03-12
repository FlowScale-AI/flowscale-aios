# Modal.com Cloud GPU Scripts

Deploy AI models to [Modal.com](https://modal.com) serverless GPUs for use as FlowScale AIOS tools.

## Prerequisites

1. **Modal account** — sign up at [modal.com](https://modal.com)
2. **Modal CLI** — install and authenticate:
   ```bash
   pip install modal
   modal setup    # opens browser to link your account
   ```
3. **HuggingFace token** — required for gated models (Gemma). Create one at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens), then store it as a Modal secret:
   ```bash
   modal secret create huggingface HF_TOKEN=hf_your_token_here
   ```

## Deploying a Model

Each script is a self-contained Modal app. Deploy with:

```bash
modal deploy scripts/z_image_turbo_modal.py   # Z-Image Turbo (image gen)
modal deploy scripts/ltx_video_modal.py       # LTX Video 2.3 (video gen)
```

First deploy downloads model weights and builds the container image (5-10 min). Subsequent deploys reuse cached images and are fast

## Connecting to FlowScale AIOS

After deploying, the CLI prints endpoint URLs like:

```
https://YOUR_ORG--app-name-classname-generate.modal.run
```

Register endpoints in FlowScale AIOS:

1. Open **Settings** in the AIOS sidebar
2. Under **Modal Endpoints**, add an entry:
   - **Model ID**: the model identifier (e.g. `Lightricks/LTX-2.3`)
   - **URL**: the `/generate` endpoint URL from the deploy output
   - **App Name**: the Modal app name (e.g. `ltx-video`)
3. Go to **Tools > Available Tools** and install the matching built-in tool

The settings are stored in `~/.flowscale/aios/settings.json`:

```json
{
  "modalEndpoints": {
    "Lightricks/LTX-2.3": {
      "url": "https://YOUR_ORG--ltx-video-ltxvideo-generate.modal.run",
      "appName": "ltx-video"
    },
    "Tongyi-MAI/Z-Image-Turbo": {
      "url": "https://YOUR_ORG--z-image-turbo-zimageturbo-generate.modal.run",
      "appName": "z-image-turbo"
    }
  }
}
```

## Available Scripts

### `z_image_turbo_modal.py` — Z-Image Turbo

Fast image generation using Tongyi-MAI/Z-Image-Turbo (SDXL-based, 4-step).

| Setting | Value |
|---------|-------|
| GPU | A10G (24GB) |
| Cold start | ~30s |
| Generation | ~2s per image |
| Output | 1024x1024 PNG |

### `ltx_video_modal.py` — LTX Video 2.3

Video generation using the Lightricks LTX-2.3 22B model with FP8 quantization.

| Setting | Value |
|---------|-------|
| GPU | A100-80GB (default) or H200 |
| Cold start | ~2-3 min (model loading) |
| Generation | ~30-90s depending on resolution/frames |
| Output | MP4 with H.264 video + AAC audio |
| Defaults | 768x512, 65 frames, 25fps (2.6s video) |

**GPU options:**

| GPU | VRAM | Status |
|-----|------|--------|
| A100-80GB | 80GB | Recommended — good balance of cost and capability |
| H200 | 141GB | Works for higher resolutions and longer videos |
| H100 | 80GB | Same VRAM as A100, works the same |
| A100-40GB | 40GB | Not enough VRAM |

To change GPU, edit the `gpu=` parameter in the script's `@app.cls()` decorator.

**Resolution constraints:**
- Width and height must be divisible by 32
- Frame count must be divisible by 8, plus 1 (e.g. 17, 25, 33, 65, 97)

## Modal Contract

All scripts follow the same API contract so AIOS can call them uniformly:

**`POST /generate`**
```json
{
  "inputs": {
    "api__prompt": "a beautiful sunset over mountains",
    "api__width": 768,
    "api__height": 512
  },
  "seed": 42
}
```

**Response:**
```json
{
  "outputs": [
    {
      "kind": "image",
      "filename": "output.png",
      "data": "<base64-encoded file>"
    }
  ]
}
```

The `kind` field is `"image"` or `"video"` depending on the model.

**`GET /health`**
```json
{"status": "ok", "model": "Model/Name"}
```

## Optional: API Key Authentication

To protect your endpoints:

1. Create a Modal secret:
   ```bash
   modal secret create flowscale-modal-key MODAL_API_KEY=your_secret_key
   ```
2. Uncomment the secret line in the script:
   ```python
   _secrets.append(modal.Secret.from_name("flowscale-modal-key"))
   ```
3. Redeploy. All requests now require `Authorization: Bearer your_secret_key`.

## Monitoring

```bash
# View live logs
modal app logs ltx-video

# List running apps
modal app list

# Stop an app (kills warm containers)
modal app stop ltx-video
```

Logs are also streamed live in the AIOS tool UI under the **Logs** tab when you run a tool.

## Cost

Modal charges per-second of GPU usage. Containers auto-scale to zero after `scaledown_window` seconds of inactivity (default: 120s). You only pay while a container is running.

Approximate costs (as of 2025):
- **A10G**: ~$0.60/hr
- **A100-80GB**: ~$3.70/hr
- **H100**: ~$4.25/hr
- **H200**: ~$6.50/hr

Check [modal.com/pricing](https://modal.com/pricing) for current rates.
