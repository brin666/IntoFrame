"""Independent semantic sky detection in the source image's coordinates.

The foreground alpha is only a protection mask. It never supplies sky labels.
The pinned NVIDIA ADE model is restricted to noncommercial research/evaluation;
see the project model provenance notes before using it outside this demo.
"""

from __future__ import annotations

from functools import lru_cache
import math

import cv2
import numpy as np
from PIL import Image

MODEL_ID = "nvidia/segformer-b0-finetuned-ade-512-512"
MODEL_REVISION = "489d5cd81a0b59fab9b7ea758d3548ebe99677da"
SKY_LABEL = 2
MIN_SKY_PROBABILITY = 0.8
MIN_POTENTIAL_SKY_PROBABILITY = 0.5
MIN_CONFIDENCE_COVERAGE = 0.9
MAX_BOUNDARY_EXTENSION_PIXELS = 12
MIN_SKY_FRACTION = 0.01
MIN_COMPONENT_FRACTION = 0.001
SUBJECT_PROTECTION_ALPHA = 2


@lru_cache(maxsize=1)
def _load_model():
    """Load official safetensors once, without repository Python execution."""
    try:
        import torch
        from transformers import AutoImageProcessor, SegformerForSemanticSegmentation

        # This small model runs on CPU independently of the GPU pipelines.
        if torch.get_num_threads() > 4:
            torch.set_num_threads(4)
        processor = AutoImageProcessor.from_pretrained(
            MODEL_ID,
            revision=MODEL_REVISION,
            use_fast=False,
            trust_remote_code=False,
        )
        model = SegformerForSemanticSegmentation.from_pretrained(
            MODEL_ID,
            revision=MODEL_REVISION,
            use_safetensors=True,
            trust_remote_code=False,
        ).eval().to("cpu")
        if str(model.config.id2label.get(SKY_LABEL, "")).lower() != "sky":
            raise RuntimeError("The pinned sky model has an unexpected class mapping.")
        return processor, model
    except Exception as error:
        raise RuntimeError("The semantic sky detection model could not be loaded.") from error


def _suitability(
    eligible: bool, sky_fraction: float, confidence_coverage: float, status: str | None = None
) -> dict:
    status = status or ("supported" if eligible else "no-sky")
    return {
        "eligible": eligible,
        "skyFraction": sky_fraction,
        "confidenceCoverage": confidence_coverage,
        "reason": None if eligible else (
            "Sky boundaries are uncertain. Choose an outdoor photo with a clearer, open sky."
            if status == "uncertain" else
            "No sufficiently clear sky was detected. Choose an outdoor photo with visible sky."
        ),
        "model": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "status": status,
    }


def sky_mask_from_probabilities(
    sky_probability: np.ndarray,
    sky_winner: np.ndarray,
    subject_mask: Image.Image,
) -> tuple[Image.Image, dict]:
    """Build editable sky from semantic evidence, without loading a model.

    Probabilities and the sky argmax indicator must share a grid. They are
    resized to the native subject-mask grid before the confidence decision.
    High-confidence sky seeds can extend by at most 12 native pixels through
    potential sky with probability >=0.5 and a sky argmax. Every nonzero output
    pixel has subject alpha below 2. Broad ambiguity rejects the whole edit.
    Components need no top-border connection: cloudy sky and sky seen between
    buildings remain eligible when the model recognizes them reliably.
    """
    probability = np.asarray(sky_probability, dtype=np.float32)
    winner = np.asarray(sky_winner)
    if probability.ndim != 2 or probability.shape != winner.shape or not probability.size:
        raise ValueError("Sky probabilities and class labels must share a nonempty 2D grid.")
    if not np.isfinite(probability).all() or np.any((probability < 0) | (probability > 1)):
        raise ValueError("Sky probabilities must be finite values between zero and one.")

    alpha = np.asarray(subject_mask.convert("L"), dtype=np.uint8)
    height, width = alpha.shape
    if probability.shape != alpha.shape:
        probability = cv2.resize(probability, (width, height), interpolation=cv2.INTER_LINEAR)
        winner = cv2.resize(winner.astype(np.uint8), (width, height), interpolation=cv2.INTER_NEAREST)
    sky_region = winner.astype(bool) & (alpha < SUBJECT_PROTECTION_ALPHA)
    potential = (probability >= MIN_POTENTIAL_SKY_PROBABILITY) & sky_region
    confident = (
        (probability >= MIN_SKY_PROBABILITY)
        & sky_region
    )
    potential_pixels = int(np.count_nonzero(potential))
    confidence_coverage = (
        float(np.count_nonzero(confident) / potential_pixels) if potential_pixels else 0.0
    )
    if (
        potential_pixels / alpha.size >= MIN_SKY_FRACTION
        and confidence_coverage < MIN_CONFIDENCE_COVERAGE
    ):
        return Image.new("L", subject_mask.size, 0), _suitability(
            False, float(np.count_nonzero(confident) / alpha.size), confidence_coverage, "uncertain"
        )

    if confident.any():
        distance_to_seed = cv2.distanceTransform(
            (~confident).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE
        )
        confident |= potential & (distance_to_seed <= MAX_BOUNDARY_EXTENSION_PIXELS)

    # Remove specks after subject exclusion, so small isolated gaps in the
    # foreground cannot become editable just because they border a large sky.
    count, labels, statistics, _ = cv2.connectedComponentsWithStats(
        confident.astype(np.uint8), connectivity=8
    )
    minimum = max(8, math.ceil(alpha.size * MIN_COMPONENT_FRACTION))
    retained_labels = np.zeros(count, dtype=bool)
    retained_labels[1:] = statistics[1:, cv2.CC_STAT_AREA] >= minimum
    confident = retained_labels[labels]
    sky_fraction = float(np.count_nonzero(confident) / alpha.size)
    eligible = sky_fraction >= MIN_SKY_FRACTION
    if not eligible:
        return Image.new("L", subject_mask.size, 0), _suitability(False, sky_fraction, confidence_coverage)

    # Distance to the nearest excluded pixel provides an inward feather. A
    # padded zero border also defines that distance for an all-sky image.
    padded = np.pad(confident.astype(np.uint8), 1, constant_values=0)
    distance = cv2.distanceTransform(padded, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]
    feather_pixels = 2.0
    editable = np.rint(np.clip(distance / feather_pixels, 0, 1) * 255).astype(np.uint8)
    # Explicit final clamping keeps the exclusion invariant independent of
    # future changes to feathering or connected-component processing.
    editable[~confident | (alpha >= SUBJECT_PROTECTION_ALPHA)] = 0
    return Image.fromarray(editable), _suitability(True, sky_fraction, confidence_coverage)


def sky_mask_from_logits(
    logits: np.ndarray, subject_mask: Image.Image
) -> tuple[Image.Image, dict]:
    """Convert class-first ADE logits to a conservative sky mask using NumPy."""
    values = np.asarray(logits, dtype=np.float32)
    if values.ndim != 3 or values.shape[0] <= SKY_LABEL or not values.size:
        raise ValueError("Sky model logits must have class, height and width dimensions.")
    if not np.isfinite(values).all():
        raise ValueError("Sky model logits contain invalid values.")
    peak = values.max(axis=0)
    exponentials = np.exp(values - peak)
    probability = exponentials[SKY_LABEL] / exponentials.sum(axis=0)
    winner = values.argmax(axis=0) == SKY_LABEL
    return sky_mask_from_probabilities(probability, winner, subject_mask)


def detect_sky(
    source: Image.Image, subject_mask: Image.Image
) -> tuple[Image.Image, dict]:
    """Return an L editable-sky mask and suitability, preserving subject alpha.

    A successfully analyzed photo with no credible sky returns an empty mask.
    Loading or inference failures raise RuntimeError so the caller can expose
    an unavailable state instead of silently substituting background pixels.
    """
    if source.size != subject_mask.size:
        raise ValueError("Source and subject mask sizes differ.")
    try:
        processor, model = _load_model()
        import torch

        inputs = processor(images=source.convert("RGB"), return_tensors="pt")
        with torch.inference_mode():
            prediction = model(**inputs).logits
        if prediction.ndim != 4 or prediction.shape[0] != 1:
            raise RuntimeError("Sky detection returned unexpected output dimensions.")
        logits = prediction[0].float().cpu().numpy()
        return sky_mask_from_logits(logits, subject_mask)
    except Exception as error:
        raise RuntimeError("Semantic sky detection is unavailable for this photo.") from error
