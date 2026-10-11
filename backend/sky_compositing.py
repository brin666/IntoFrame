"""Bounded sky replacement and subject-free layers sharing one center image."""

import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def build_sky_layers(source: Image.Image, subject: Image.Image, editable: Image.Image,
                     generated: Image.Image) -> tuple[Image.Image, Image.Image, Image.Image]:
    if any(image.size != source.size for image in (subject, editable, generated)):
        raise ValueError("Sky compositing assets must share source coordinates.")
    rgb = np.asarray(source.convert("RGB"))
    alpha = np.asarray(subject.convert("L"))
    weight = np.asarray(editable.convert("L")).copy()
    hidden = alpha > 0
    # Only unobserved subject pixels need approximation. Visible non-sky RGB
    # is restored byte-for-byte, including ground/support and other buildings.
    hole = cv2.dilate(hidden.astype(np.uint8), np.ones((7, 7), np.uint8)) * 255
    factor = min(1.0, 1024 / max(source.size))
    small_size = (max(1, round(source.width * factor)), max(1, round(source.height * factor)))
    small_rgb = cv2.resize(rgb, small_size, interpolation=cv2.INTER_AREA)
    small_hole = cv2.resize(hole, small_size, interpolation=cv2.INTER_NEAREST)
    filled = cv2.inpaint(small_rgb, small_hole, 5, cv2.INPAINT_TELEA)
    filled = cv2.resize(filled, source.size, interpolation=cv2.INTER_LINEAR)
    scene_rgb = rgb.copy()
    scene_rgb[hidden] = filled[hidden]
    if hidden.any():
        # Infer SKY ONLY UNDER the removed subject from nearby clear pixels.
        # Step beyond the inward semantic feather, rather than spreading sky
        # into visible non-sky pixels. This is an occlusion fill, not a label.
        distance = distance_transform_edt(~hidden)
        valid = (~hidden) & (distance >= 8)
        if not valid.any():
            valid = ~hidden
        if valid.any():
            indices = distance_transform_edt(~valid, return_distances=False, return_indices=True)
            weight[hidden] = weight[indices[0][hidden], indices[1][hidden]]
    # Observed translucent RGB already contains the original support surface.
    # Replacing its underlay when that surface is unedited would blend twice
    # against a guessed fill. Keep those contacts exactly as observed.
    unedited_edge = hidden & (alpha < 250) & (weight == 0)
    scene_rgb[unedited_edge] = rgb[unedited_edge]
    underlay = Image.fromarray(weight, "L")
    scene = Image.fromarray(np.dstack((scene_rgb, 255 - weight)), "RGBA")
    background = Image.alpha_composite(generated.convert("RGBA"), scene).convert("RGB")
    return background, scene, underlay
