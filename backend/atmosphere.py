"""Deterministic sky grading and modest RGB ambience for retained scene layers.

These operations change existing pixel colors. They do not estimate lighting,
invent illumination, or alter a layer's geometry/alpha. Sky denoising is kept
separate from the pointwise scene curve so subject detail is never filtered.
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter

SKY_GRADE_VERSION = "pink-clouds-blue-hour-v2"
LAYER_HARMONIZATION_VERSION = "pointwise-ambient-rgb-v1"
ATMOSPHERE_VERSION = "sky-scene-ambience-v2"

STYLES = frozenset(("dreamy-pink", "golden-hour", "cinematic-night"))
STYLE_GRADING = {
    "dreamy-pink": {
        "sky": "continuous lavender-rose cloud luminance",
        "scene": "mild warm-lilac RGB ambience",
    },
    "golden-hour": {"sky": "unchanged", "scene": "unchanged"},
    "cinematic-night": {
        "sky": "blue-hour clouds with bright-speck suppression",
        "scene": "moderate exposure reduction with cool shadows",
    },
}

_LUMA = np.array((0.2126, 0.7152, 0.0722), dtype=np.float32)


def _pixels(image: Image.Image, style: str) -> np.ndarray:
    if style not in STYLES:
        raise ValueError("Unknown atmosphere style.")
    if not isinstance(image, Image.Image):
        raise TypeError("Atmosphere grading requires a PIL image.")
    if image.mode not in ("RGB", "RGBA"):
        raise ValueError("Atmosphere grading requires RGB or RGBA pixels.")
    if image.width < 1 or image.height < 1:
        raise ValueError("Atmosphere grading requires a non-empty image.")
    pixels = np.asarray(image)
    if not np.isfinite(pixels).all():
        raise ValueError("Atmosphere grading requires finite pixel values.")
    return pixels


def _image(rgb: np.ndarray, original: Image.Image, pixels: np.ndarray) -> Image.Image:
    output = np.rint(np.clip(rgb, 0, 255)).astype(np.uint8)
    if original.mode == "RGBA":
        output = np.dstack((output, pixels[..., 3]))
    result = Image.fromarray(output, original.mode)
    result.info.update(original.info)
    return result


def _smoothstep(values: np.ndarray, low: float, high: float) -> np.ndarray:
    position = np.clip((values - low) / (high - low), 0, 1)
    return position * position * (3 - 2 * position)


def _pink_sky(rgb: np.ndarray) -> np.ndarray:
    # A continuous palette preserves the shape/contrast of generated clouds.
    # Anchors retain pale pink highlights and lavender cloud shadows rather
    # than allowing the compact image model's grey-blue palette to dominate.
    # The small sky patch is enlarged; remove native diffusion grain before
    # enlargement while keeping broad cloud forms. Never filter subject RGB.
    texture = Image.fromarray(np.rint(rgb).astype(np.uint8), "RGB")
    rgb = np.asarray(texture.filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32)
    luma = rgb @ _LUMA
    positions = np.array((0.0, 128.0, 255.0), dtype=np.float32)
    palette = np.array(((92, 87, 139), (205, 162, 189), (251, 224, 227)), dtype=np.float32)
    mapped = np.stack([
        np.interp(luma, positions, palette[:, channel]) for channel in range(3)
    ], axis=-1)
    return mapped * 0.92 + rgb * 0.08


def _night_sky(rgb: np.ndarray) -> np.ndarray:
    # Filter only the synthetic sky. The scale is relative to the native sky
    # patch, avoiding source-resolution-dependent coarse star blobs.
    shortest = min(rgb.shape[:2])
    median_size = max(3, min(9, round(shortest / 90) | 1))
    texture = Image.fromarray(np.rint(rgb).astype(np.uint8), "RGB")
    median = np.asarray(texture.filter(ImageFilter.MedianFilter(median_size)), dtype=np.float32)
    luma = rgb @ _LUMA
    median_luma = median @ _LUMA
    # A small bright island is replaced by its local sky estimate; dark cloud
    # structure and broad bright cloud banks survive this asymmetric filter.
    speck = _smoothstep(luma - median_luma, 3.0, 18.0)[..., None]
    cleaned = rgb * (1 - speck) + median * speck
    texture = Image.fromarray(np.rint(np.clip(cleaned, 0, 255)).astype(np.uint8), "RGB")
    radius = max(0.65, min(3.0, shortest / 210))
    low_frequency = np.asarray(texture.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)
    cloud_luma = (cleaned * 0.18 + low_frequency * 0.82) @ _LUMA

    # Preserve the generated luminance ordering with a smooth shoulder. Bright
    # clouds stay blue, never become extracted white stars. A restrained
    # vertical gradient adds evening depth without creating a hard horizon.
    cloud = cloud_luma / 255
    shoulder = cloud * (1.15 - 0.15 * cloud)
    mapped = np.stack((20 + 50 * shoulder, 36 + 63 * shoulder, 65 + 78 * shoulder), axis=-1)
    height = rgb.shape[0]
    gradient = np.linspace(-1, 1, height, dtype=np.float32)[:, None, None]
    return mapped + gradient * np.array((3, 5, 7), dtype=np.float32)


def grade_sky(image: Image.Image, style: str) -> Image.Image:
    """Grade an isolated generated sky at its native resolution.

    RGB/RGBA mode, dimensions, alpha, and the input image are preserved.
    Golden Hour returns the exact input object without a pixel conversion.
    Apply once to the model's ungraded sky crop, before its final upscaling.
    """
    pixels = _pixels(image, style)
    if style == "golden-hour":
        return image
    rgb = pixels[..., :3].astype(np.float32)
    graded = _pink_sky(rgb) if style == "dreamy-pink" else _night_sky(rgb)
    return _image(graded, image, pixels)


def harmonize_layer(image: Image.Image, style: str) -> Image.Image:
    """Apply the same pointwise RGB curve to subject and retained scene.

    No spatial filtering, resizing, mask change, or alpha-dependent color
    adjustment occurs. Equal input RGB always receives equal output RGB,
    including translucent subject contacts and separately retained scenery.
    """
    pixels = _pixels(image, style)
    if style == "golden-hour":
        return image
    rgb = pixels[..., :3].astype(np.float32)
    luma = rgb @ _LUMA
    if style == "dreamy-pink":
        ambience = 1 - 0.65 * _smoothstep(luma, 145, 250)
        graded = rgb + ambience[..., None] * np.array((6, -1, 4), dtype=np.float32)
    else:
        highlight = _smoothstep(luma, 65, 235)
        gain = 0.66 + 0.19 * highlight
        shadow = 1 - _smoothstep(luma, 80, 220)
        graded = rgb * gain[..., None] + shadow[..., None] * np.array((-1, 2, 7), dtype=np.float32)
    return _image(graded, image, pixels)
