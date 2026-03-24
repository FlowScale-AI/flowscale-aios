"""
Florence-2 captioning module for Flux LoRA Trainer plugin.
Lazy-loads microsoft/Florence-2-large on first call.
"""

import base64
import io
import re
from pathlib import Path

_model = None
_processor = None
_device = None


def _load_model():
    global _model, _processor, _device

    if _model is not None:
        return

    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if _device == "cuda" else torch.float32

    print(f"[captioner] Loading Florence-2-large on {_device}...")
    _processor = AutoProcessor.from_pretrained(
        "microsoft/Florence-2-large",
        trust_remote_code=True,
    )
    _model = AutoModelForCausalLM.from_pretrained(
        "microsoft/Florence-2-large",
        torch_dtype=dtype,
        trust_remote_code=True,
    ).to(_device)
    _model.eval()
    print("[captioner] Florence-2-large loaded.")


def _load_image(image_path=None, image_b64=None):
    from PIL import Image

    if image_b64 is not None:
        # Strip data URL prefix if present
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        image_bytes = base64.b64decode(image_b64)
        return Image.open(io.BytesIO(image_bytes)).convert("RGB")

    if image_path is not None:
        return Image.open(image_path).convert("RGB")

    raise ValueError("Either image_path or image_b64 must be provided.")


def _task_token_for_mode(mode: str) -> str:
    mode_map = {
        "detailed": "<MORE_DETAILED_CAPTION>",
        "brief": "<CAPTION>",
        "dense": "<DENSE_REGION_CAPTION>",
    }
    return mode_map.get(mode, "<MORE_DETAILED_CAPTION>")


def _strip_task_prefix(text: str, task_token: str) -> str:
    """Remove the task prefix token from model output if present."""
    # Florence-2 sometimes echoes the task token at the start of output
    stripped = text.strip()
    if stripped.startswith(task_token):
        stripped = stripped[len(task_token):].strip()
    # Also strip any trailing special tokens of the form <...>
    stripped = re.sub(r"<[^>]+>\s*$", "", stripped).strip()
    return stripped


def caption_image(image_path=None, image_b64=None, mode="detailed") -> str:
    """
    Caption a single image using Florence-2-large.

    Args:
        image_path: Path to image file on disk.
        image_b64:  Base64-encoded image (data URL or raw base64 string).
        mode:       One of "detailed" (default), "brief", or "dense".

    Returns:
        Caption string.
    """
    import torch

    _load_model()

    image = _load_image(image_path=image_path, image_b64=image_b64)
    task_token = _task_token_for_mode(mode)

    inputs = _processor(
        text=task_token,
        images=image,
        return_tensors="pt",
    ).to(_device)

    with torch.no_grad():
        generated_ids = _model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=1024,
            num_beams=3,
            do_sample=False,
        )

    generated_text = _processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    caption = _strip_task_prefix(generated_text, task_token)
    return caption
