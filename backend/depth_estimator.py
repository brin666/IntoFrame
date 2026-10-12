"""One-shot relative depth and conservative background preparation.

The 8-bit PNG is a display control signal, not metric distance. Native float32
prediction retains subject relief that scene-wide PNG normalization can clip.
Larger values mean nearer; native assets use EXIF-corrected source coordinates.
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


def _predict_raw(image: Image.Image) -> np.ndarray:
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
    return np.ascontiguousarray(prediction, dtype=np.float32)


def _normalize_prediction(prediction: np.ndarray) -> Image.Image:
    """Keep the legacy percentile clipping and smoothing exactly as before."""
    if prediction.ndim != 2 or not prediction.size:
        raise RuntimeError("Depth estimation returned invalid dimensions.")
    if not np.isfinite(prediction).all():
        raise RuntimeError("Depth estimation returned invalid values.")
    low, high = np.percentile(prediction, (2, 98))
    if high - low < 1e-6:
        raise RuntimeError("The depth map has too little range for spatial motion.")
    # The relative model predicts inverse-depth-like values: larger is nearer.
    near = np.clip((prediction - low) / (high - low), 0.0, 1.0)
    near = cv2.GaussianBlur(near.astype(np.float32), (5, 5), 0.9)
    return Image.fromarray(np.round(near * 255).astype(np.uint8), "L")


def estimate_with_raw(image: Image.Image) -> tuple[Image.Image, np.ndarray]:
    """Return display depth and unquantized native depth from one inference."""
    prediction = _predict_raw(image)
    if prediction.shape != (image.height, image.width):
        raise RuntimeError("Depth estimation returned a map with the wrong dimensions.")
    return _normalize_prediction(prediction), prediction


def estimate(image: Image.Image) -> Image.Image:
    """Legacy PIL API; callers needing subject geometry use estimate_with_raw."""
    return estimate_with_raw(image)[0]


def subject_depth_metadata(
    prediction: np.ndarray, mask: Image.Image
) -> tuple[dict | None, dict]:
    """Describe raw relief without turning a flat/weak subject into strong depth.

    A one-percent scene-relative span is a conservative noise gate, not a model
    confidence score. The consumer must use ``eligible`` before normalizing the
    subject's range. Empty opaque masks retain the legacy scene-only output.
    """
    alpha = np.asarray(mask.convert("L"))
    if prediction.shape != alpha.shape:
        raise RuntimeError("Source alpha mask and raw depth map do not share dimensions.")
    if prediction.ndim != 2 or not np.isfinite(prediction).all():
        raise RuntimeError("Depth estimation returned invalid values.")
    values = prediction[alpha > 160]
    if not values.size:
        return None, {
            "status": "no-opaque-subject", "eligible": False,
            "subjectPixelCount": 0,
            "reason": "The subject mask has no opaque pixels to measure depth relief.",
        }
    global_low, global_high = np.percentile(prediction, (2, 98))
    subject_low, subject_high = np.percentile(values, (5, 95))
    scene_span = float(global_high - global_low)
    subject_span = float(subject_high - subject_low)
    # Float32 precision scales with value magnitude; do not inflate roundoff.
    epsilon = max(1e-6, float(np.max(np.abs(values))) * np.finfo(np.float32).eps * 16)
    range_ratio = subject_span / max(scene_span, epsilon)
    status = "ready"
    reason = None
    if subject_span <= epsilon:
        status = "flat-subject-range"
        reason = "The depth model found too little subject relief for depth motion."
    elif range_ratio < 0.01:
        status = "weak-subject-range"
        reason = "Subject depth relief is weak relative to the scene; depth motion is reduced."
    metadata = {
        "width": mask.width, "height": mask.height,
        "encoding": "float32-little-endian-row-major",
        "model": MODEL_ID, "revision": MODEL_REVISION,
        "source": "source.webp", "mask": "mask.png",
        "nearDirection": "larger-prediction-is-nearer",
        "subjectP05": float(subject_low), "subjectP95": float(subject_high),
        "subjectMedian": float(np.median(values)),
        "globalP02": float(global_low), "globalP98": float(global_high),
        "globalMin": float(prediction.min()), "globalMax": float(prediction.max()),
    }
    diagnostics = {
        "status": status, "eligible": status == "ready",
        "subjectPixelCount": int(values.size),
        "subjectRange": subject_span, "subjectRangeRatio": range_ratio,
        "minimumSubjectRange": epsilon,
        "reason": reason,
    }
    return metadata, diagnostics


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
