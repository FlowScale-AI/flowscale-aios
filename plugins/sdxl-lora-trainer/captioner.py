"""
BLIP captioning module for Flux LoRA Trainer plugin.
Lazy-loads Salesforce/blip-image-captioning-large on first call.
"""

import base64
import io
from pathlib import Path

_model = None
_processor = None
_device = None

MODEL_ID = "Salesforce/blip-image-captioning-large"


def _load_model():
    global _model, _processor, _device

    if _model is not None:
        return

    import torch
    from transformers import BlipProcessor, BlipForConditionalGeneration

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if _device == "cuda" else torch.float32

    print(f"[captioner] Loading {MODEL_ID} on {_device}...")
    _processor = BlipProcessor.from_pretrained(MODEL_ID)
    _model = BlipForConditionalGeneration.from_pretrained(
        MODEL_ID, torch_dtype=dtype,
    ).to(_device)
    _model.eval()
    print(f"[captioner] {MODEL_ID} loaded.")


def _load_image(image_path=None, image_b64=None):
    from PIL import Image

    if image_b64 is not None:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        image_bytes = base64.b64decode(image_b64)
        return Image.open(io.BytesIO(image_bytes)).convert("RGB")

    if image_path is not None:
        return Image.open(image_path).convert("RGB")

    raise ValueError("Either image_path or image_b64 must be provided.")


def caption_image(image_path=None, image_b64=None, mode="detailed") -> str:
    """
    Caption a single image using BLIP.

    Args:
        image_path: Path to image file on disk.
        image_b64:  Base64-encoded image (data URL or raw base64 string).
        mode:       "detailed" (conditional, longer) or "brief" (unconditional, shorter).

    Returns:
        Caption string.
    """
    import torch

    _load_model()

    image = _load_image(image_path=image_path, image_b64=image_b64)
    dtype = torch.float16 if _device == "cuda" else torch.float32

    if mode == "detailed":
        inputs = _processor(image, "a photography of", return_tensors="pt").to(_device, dtype)
        max_tokens = 100
    else:
        inputs = _processor(image, return_tensors="pt").to(_device, dtype)
        max_tokens = 50

    with torch.no_grad():
        out = _model.generate(**inputs, max_new_tokens=max_tokens, num_beams=3)

    return _processor.decode(out[0], skip_special_tokens=True)
