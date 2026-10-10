"""One-shot relative depth and conservative background preparation.

The exported 8-bit PNG is a display/mesh control signal, not metric distance.
White means nearer. All native assets use the EXIF-corrected source coordinates.
"""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np
from PIL import Image

MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"
MODEL_REVISION = "5426e4f0f36572d16453bbda7a8389317b1bef99"
OVERSCAN_FRACTION = 0.06


@lru_cache(maxsize=1)
def _load_model():
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Depth Anything V2 Small requires an NVIDIA GPU in this MVP.")
    processor = AutoImageProcessor.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    model = AutoModelForDepthEstimation.from_pretrained(
        MODEL_ID, revision=MODEL_REVISION, use_safetensors=True
    ).eval().to("cuda")
    return processor, model


def estimate(image: Image.Image) -> Image.Image:
    import torch

    processor, model = _load_model()
    inputs = processor(images=image, return_tensors="pt").to("cuda")
    with torch.inference_mode():
        prediction = model(**inputs).predicted_depth
        prediction = torch.nn.functional.interpolate(
            prediction.unsqueeze(1),
            size=(image.height, image.width),
            mode="bicubic",
            align_corners=False,
        )[0, 0].float().cpu().numpy()
    if not np.isfinite(prediction).all():
        raise RuntimeError("Depth estimation returned invalid values.")
    low, high = np.percentile(prediction, (2, 98))
    if high - low < 1e-6:
        raise RuntimeError("The depth map has too little range for spatial motion.")
    # The relative model predicts inverse-depth-like values: larger is nearer.
    near = np.clip((prediction - low) / (high - low), 0.0, 1.0)
    near = cv2.GaussianBlur(near.astype(np.float32), (5, 5), 0.9)
    return Image.fromarray(np.round(near * 255).astype(np.uint8), "L")


def prepare_render_assets(
    image: Image.Image, mask: Image.Image, depth: Image.Image
) -> tuple[Image.Image, Image.Image, float, dict[str, int]]:
    """Fill the occluded subject area, then add reflected overscan.

    OpenCV Telea is a local, non-generative stopgap. It is mostly hidden by the
    foreground layer and must be visually rechecked before wider camera travel.
    """
    rgb = np.asarray(image.convert("RGB"))
    alpha = np.asarray(mask.convert("L"))
    native_depth = np.asarray(depth.convert("L"))
    if rgb.shape[:2] != alpha.shape or alpha.shape != native_depth.shape:
        raise RuntimeError("Source, alpha mask and depth map do not share dimensions.")

    height, width = alpha.shape
    hole = (alpha > 40).astype(np.uint8) * 255
    hole = cv2.dilate(hole, np.ones((7, 7), np.uint8), iterations=1)
    # Keep Telea bounded on large uploads; only a narrow uncovered rim is seen.
    factor = min(1.0, 1024.0 / max(width, height))
    if factor < 1:
        small_size = (round(width * factor), round(height * factor))
        small_rgb = cv2.resize(rgb, small_size, interpolation=cv2.INTER_AREA)
        small_hole = cv2.resize(hole, small_size, interpolation=cv2.INTER_NEAREST)
        fill_small = cv2.inpaint(small_rgb, small_hole, 5, cv2.INPAINT_TELEA)
        fill = cv2.resize(fill_small, (width, height), interpolation=cv2.INTER_CUBIC)
    else:
        fill = cv2.inpaint(rgb, hole, 5, cv2.INPAINT_TELEA)
    # Preserve untouched image pixels and blend only at the mask edge.
    blend = cv2.GaussianBlur(hole.astype(np.float32) / 255.0, (0, 0), 2.0)[..., None]
    filled_rgb = np.round(rgb * (1.0 - blend) + fill * blend).astype(np.uint8)
    filled_depth = cv2.inpaint(native_depth, hole, 5, cv2.INPAINT_TELEA)
    filled_depth = cv2.GaussianBlur(filled_depth, (5, 5), 0.9)

    subject_values = native_depth[alpha > 160]
    foreground_depth = float(np.median(subject_values) / 255.0) if subject_values.size else 0.5
    pad_x = max(12, round(width * OVERSCAN_FRACTION))
    pad_y = max(12, round(height * OVERSCAN_FRACTION))
    border = cv2.BORDER_REFLECT_101
    render_rgb = cv2.copyMakeBorder(filled_rgb, pad_y, pad_y, pad_x, pad_x, border)
    render_depth = cv2.copyMakeBorder(filled_depth, pad_y, pad_y, pad_x, pad_x, border)
    return (
        Image.fromarray(render_rgb, "RGB"),
        Image.fromarray(render_depth, "L"),
        foreground_depth,
        {"left": pad_x, "right": pad_x, "top": pad_y, "bottom": pad_y},
    )
