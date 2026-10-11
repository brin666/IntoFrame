"""Resolve local semantic sky omissions against the native subject silhouette.

The semantic model sees a small grid. A cell crossing a roof can label some
visible sky as part of that roof. This refinement requires existing sky, native
RGB agreement, and a short connected path beside the subject; it never derives
sky from the inverse alpha or changes the subject alpha.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


SKY_LABEL = 2
SUBJECT_PROTECTION_ALPHA = 2
RELIABLE_SUBJECT_ALPHA = 128
CONFIRMED_SKY_ALPHA = 250
MODEL_CELL_REACH = 4.0
MAX_NATIVE_REACH = 64
MAX_COLOR_DISTANCE_LAB = 8.0
MAX_SUBJECT_CLASS_CONFIDENCE = 0.98
MIN_SUBJECT_CLASS_SKY_PROBABILITY = 0.01


def refine_sky_boundary(
    source: Image.Image,
    subject_mask: Image.Image,
    editable: Image.Image,
    logits: np.ndarray,
) -> tuple[Image.Image, dict]:
    """Extend editable sky only in a bounded, RGB-supported subject edge band.

    Inputs and output share native source coordinates. Class-first logits come
    from the existing semantic detector; no extra inference is performed.
    Other semantic classes cannot become sky. The local subject class can be
    reconsidered only below 0.98 confidence and with at least 0.01 sky evidence.
    Even then it needs close color agreement with confirmed nearby sky and a
    connected path to that sky. Existing editable pixels outside this band are
    preserved. Alpha >=2 is protected, including translucent hair and detail.
    """
    if source.size != subject_mask.size or source.size != editable.size:
        raise ValueError("Sky refinement assets must share source coordinates.")
    values = np.asarray(logits, dtype=np.float32)
    if values.ndim != 3 or values.shape[0] <= SKY_LABEL or not values.size:
        raise ValueError("Sky refinement logits must have class, height and width dimensions.")
    if not np.isfinite(values).all():
        raise ValueError("Sky refinement logits contain invalid values.")

    rgb = np.asarray(source.convert("RGB"), dtype=np.uint8)
    alpha = np.asarray(subject_mask.convert("L"), dtype=np.uint8)
    original = np.asarray(editable.convert("L"), dtype=np.uint8)
    height, width = alpha.shape
    if np.any((original > 0) & (alpha >= SUBJECT_PROTECTION_ALPHA)):
        raise ValueError("Editable sky overlaps protected subject alpha.")

    reach = min(MAX_NATIVE_REACH, max(1, math.ceil(MODEL_CELL_REACH * max(
        width / values.shape[2], height / values.shape[1]
    ))))
    metrics = {
        "method": "native-rgb-connected-boundary",
        "status": "no-change",
        "reachPixels": reach,
        "modelGrid": [int(values.shape[2]), int(values.shape[1])],
        "colorThresholdLab": MAX_COLOR_DISTANCE_LAB,
        "candidatePixels": 0,
        "changedPixels": 0,
        "addedPixels": 0,
        "strengthenedPixels": 0,
        "blockedOtherClassPixels": 0,
        "maximumChangedDistanceToSubject": 0.0,
        "maximumChangedDistanceToSky": 0.0,
    }
    confirmed = (original >= CONFIRMED_SKY_ALPHA) & (alpha < SUBJECT_PROTECTION_ALPHA)
    reliable = alpha >= RELIABLE_SUBJECT_ALPHA
    if not confirmed.any() or not reliable.any():
        metrics["status"] = "no-confirmed-sky" if not confirmed.any() else "no-reliable-subject"
        return Image.fromarray(original.copy(), "L"), metrics

    # Distances and nearest RGB references stay on the native grid. A global
    # sky palette would also match unrelated blue objects elsewhere in a scene.
    sky_distance, sky_indices = distance_transform_edt(~confirmed, return_indices=True)
    subject_distance, subject_indices = distance_transform_edt(~reliable, return_indices=True)
    band = (
        (alpha < SUBJECT_PROTECTION_ALPHA)
        & (subject_distance <= reach)
        & (sky_distance <= reach)
    )
    if not band.any():
        return Image.fromarray(original.copy(), "L"), metrics

    exponentials = np.exp(values - values.max(axis=0))
    probabilities = exponentials / exponentials.sum(axis=0)
    winner = cv2.resize(values.argmax(axis=0).astype(np.int32), (width, height),
                        interpolation=cv2.INTER_NEAREST)
    # Preserve each confident cell's footprint; interpolating confidence would
    # weaken its protection at a neighboring uncertain subject cell.
    winner_confidence = cv2.resize(probabilities.max(axis=0), (width, height),
                                  interpolation=cv2.INTER_NEAREST)
    sky_probability = cv2.resize(probabilities[SKY_LABEL], (width, height),
                                interpolation=cv2.INTER_LINEAR)
    local_subject_class = winner[subject_indices[0], subject_indices[1]]
    subject_cell_uncertain = (
        (winner == local_subject_class)
        & (winner_confidence < MAX_SUBJECT_CLASS_CONFIDENCE)
        & (sky_probability >= MIN_SUBJECT_CLASS_SKY_PROBABILITY)
    )
    semantic_allowed = (winner == SKY_LABEL) | subject_cell_uncertain

    lab = cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)
    nearest_sky_lab = lab[sky_indices[0], sky_indices[1]]
    color_agrees = np.linalg.norm(lab - nearest_sky_lab, axis=2) <= MAX_COLOR_DISTANCE_LAB
    possible = band & color_agrees & semantic_allowed
    metrics["blockedOtherClassPixels"] = int(np.count_nonzero(band & color_agrees & ~semantic_allowed))
    metrics["candidatePixels"] = int(np.count_nonzero(possible & (original == 0)))

    # Four-neighbor connectivity avoids jumping diagonally across a thin object
    # or disconnected hole. Accepted paths must touch existing confirmed sky.
    count, labels = cv2.connectedComponents((possible | confirmed).astype(np.uint8), connectivity=4)
    seeded = np.zeros(count, dtype=bool)
    seeded[np.unique(labels[confirmed])] = True
    accepted = possible & seeded[labels]
    if not accepted.any():
        return Image.fromarray(original.copy(), "L"), metrics

    region = (original > 0) | accepted
    # Subject compositing already handles its own alpha edge. Treat protected
    # subject as an occluder, so no inward sky feather retains the old sky next
    # to that silhouette. Feather only the boundary to visible, unedited scene.
    occluded_region = region | (alpha >= SUBJECT_PROTECTION_ALPHA)
    padded = np.pad(occluded_region.astype(np.uint8), 1, constant_values=0)
    inward = cv2.distanceTransform(padded, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]
    proposed = np.rint(np.clip(inward / 2.0, 0, 1) * 255).astype(np.uint8)
    output = original.copy()
    output[accepted] = np.maximum(output[accepted], proposed[accepted])
    changed = output != original
    metrics["changedPixels"] = int(np.count_nonzero(changed))
    metrics["addedPixels"] = int(np.count_nonzero(changed & (original == 0)))
    metrics["strengthenedPixels"] = int(np.count_nonzero(changed & (original > 0)))
    if changed.any():
        metrics["status"] = "refined"
        metrics["maximumChangedDistanceToSubject"] = float(subject_distance[changed].max())
        metrics["maximumChangedDistanceToSky"] = float(sky_distance[changed].max())
    return Image.fromarray(output, "L"), metrics
