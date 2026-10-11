"""Generate a sky texture field; semantic editing is enforced by compositing."""

from __future__ import annotations

import gc
import hashlib
import time

import numpy as np
import torch
from PIL import Image

MODEL_ID = "stable-diffusion-v1-5/stable-diffusion-inpainting"
MODEL_REVISION = "8a4288a76071f7280aedbdb3253bdb9e9d5d84bb"

STYLES = {
    "dreamy-pink": "photorealistic dreamy lavender and soft pink cloudscape, fluffy natural clouds filling the frame, soft ethereal light",
    "golden-hour": "photorealistic golden hour sky, warm gold and peach clouds filling the frame, sunlit cloud texture",
    "cinematic-night": "astrophotography looking straight upward at the zenith, dark navy blue night sky filling the frame, scattered subtle white stars and thin cool moonlit clouds, indigo cinematic atmosphere",
}

_pipeline = None


def _load_pipeline():
    global _pipeline
    if _pipeline is None:
        if not torch.cuda.is_available():
            raise RuntimeError("Local AI restyling requires an NVIDIA GPU with CUDA.")
        from diffusers import AutoPipelineForInpainting

        pipeline = AutoPipelineForInpainting.from_pretrained(
            MODEL_ID,
            revision=MODEL_REVISION,
            variant="fp16",
            torch_dtype=torch.float16,
            use_safetensors=True,
        )
        pipeline.enable_model_cpu_offload()
        pipeline.set_progress_bar_config(disable=True)
        _pipeline = pipeline
    return _pipeline


def _sky_only(generated: Image.Image, style: str) -> Image.Image:
    """Keep the AI cloud field when SD1.5 invents a ground horizon below it."""
    # Use the upper sky patch: the model can add land as early as 40% down the
    # image despite a sky-only prompt (observed on the astronaut sample).
    ratio = 0.35
    h = round(generated.height * ratio)
    w = round(h * generated.width / generated.height)
    x = (generated.width - w) // 2
    sky = generated.crop((x, 0, x + w, h)).resize(generated.size, Image.Resampling.LANCZOS)
    if style == "dreamy-pink":
        return sky
    rgb = np.asarray(sky.convert("RGB"), dtype=np.float32)
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    if style == "golden-hour":
        # Retain generated cloud luminance while making the preset consistently warm.
        warm = np.stack((45 + luma * 0.95, 20 + luma * 0.74, 18 + luma * 0.52), axis=-1)
        graded = warm * 0.85 + rgb * 0.15
        return Image.fromarray(np.uint8(np.clip(graded, 0, 255)), "RGB")
    # The small checkpoint often adds an orange horizon even for a night prompt.
    # Keep its generated cloud/star texture and grade it cool.
    graded = np.stack((5 + luma * 0.25, 12 + luma * 0.38, 32 + luma * 0.64), axis=-1)
    stars = np.clip((luma - 185) / 55, 0, 1)[..., None] * 0.7
    graded = graded * (1 - stars) + luma[..., None] * stars
    return Image.fromarray(np.uint8(np.clip(graded, 0, 255)), "RGB")


def restyle(source: Image.Image, mask: Image.Image, style: str) -> tuple[Image.Image, Image.Image, dict]:
    """Return subject-free generated background and original-subject composite."""
    if style not in STYLES:
        raise ValueError("Unknown background style.")
    source = source.convert("RGB")
    mask = mask.convert("L")
    if source.size != mask.size:
        raise ValueError("Source and subject mask sizes differ.")

    longest = 640
    factor = longest / max(source.size)
    target = tuple(max(64, round(size * factor / 64) * 64) for size in source.size)
    # Do not hand original roads/buildings to the generator for replacement.
    # Synthesize a sky texture independently, then sky_compositing applies the
    # separately detected editable region in canonical source coordinates.
    edit_image = Image.new("RGB", target, (127, 127, 127))
    # In this compact model, a black subject-shaped hole caused unwanted towers
    # and trees around the silhouette. Synthesize one coherent sky underlay,
    # then composite only confirmed sky at full source resolution.
    edit_mask = Image.new("L", target, 255)
    seed = int.from_bytes(hashlib.sha256(source.tobytes() + style.encode()).digest()[:4], "big")
    prompt = f"{STYLES[style]}, only open sky from edge to edge, no horizon, no ground, no objects"
    negative = (
        "building, tower, clock, person, animal, tree, branches, leaves, forest, "
        "mountain, ground, horizon, water, lake, ocean, field, object, silhouette, "
        "duplicate subject, painting, cartoon, text, logo, artifacts"
    )
    if style == "cinematic-night":
        negative += ", sunrise, sunset, orange, yellow, brown, desert, daytime, sun"
    start = time.perf_counter()
    model_was_loaded = _pipeline is not None
    load_seconds = 0.0
    inference_seconds = 0.0
    try:
        pipeline = _load_pipeline()
        load_seconds = time.perf_counter() - start
        inference_start = time.perf_counter()
        output = pipeline(
            prompt=prompt,
            negative_prompt=negative,
            image=edit_image,
            mask_image=edit_mask,
            guidance_scale=9.0,
            strength=1.0,
            num_inference_steps=22,
            generator=torch.Generator(device="cpu").manual_seed(seed),
        )
        if output.nsfw_content_detected and any(output.nsfw_content_detected):
            raise RuntimeError("The image model declined this result. Try another photo.")
        generated = output.images[0]
        inference_seconds = time.perf_counter() - inference_start
    except torch.cuda.OutOfMemoryError as exc:
        torch.cuda.empty_cache()
        raise RuntimeError("The GPU ran out of memory during background generation. Close other GPU apps and retry.") from exc
    finally:
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    generated = _sky_only(generated.convert("RGB"), style).resize(source.size, Image.Resampling.LANCZOS)
    background = generated
    composite = Image.composite(source, background, mask)
    return background, composite, {
        "seconds": round(time.perf_counter() - start, 2),
        "loadSeconds": round(load_seconds, 2),
        "inferenceSeconds": round(inference_seconds, 2),
        "modelWasLoaded": model_was_loaded,
        "modelSize": list(target), "seed": seed,
        "modelRevision": MODEL_REVISION,
        "steps": 22, "guidanceScale": 9.0, "strength": 1.0,
        "skyCropFraction": 0.35, "prompt": prompt, "negativePrompt": negative,
    }
