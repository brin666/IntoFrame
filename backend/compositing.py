"""Conservative straight-alpha edge color recovery; never erode the mask."""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def recover_subject_edges(source: Image.Image, mask: Image.Image) -> tuple[Image.Image, dict]:
    """Recover RGB only in a <=4px semitransparent silhouette band.

    Treat observed edge RGB as alpha*foreground + (1-alpha)*old_background.
    Nearby opaque foreground regularizes this ambiguous inverse problem. Narrow
    support and a 48/255 channel correction limit avoid recoloring subject cores
    or replacing fine structures far from a reliable foreground reference.
    Output is straight RGBA, not premultiplied; alpha stays byte-identical.
    """
    if source.size != mask.size:
        raise ValueError("Source and subject mask sizes differ.")
    rgb = np.asarray(source.convert("RGB"), dtype=np.uint8)
    alpha_bytes = np.asarray(mask.convert("L"), dtype=np.uint8)
    alpha = alpha_bytes.astype(np.float32) / 255
    corrected = rgb.copy()
    opaque = alpha_bytes >= 250
    clear = alpha_bytes <= 2
    count = 0
    if opaque.any() and clear.any():
        bg_distance, bg_index = distance_transform_edt(~clear, return_indices=True)
        fg_distance, fg_index = distance_transform_edt(~opaque, return_indices=True)
        band = (alpha_bytes > 2) & (alpha_bytes < 250) & (bg_distance <= 4) & (fg_distance <= 8)
        if band.any():
            observed = rgb[band].astype(np.float32)
            old_bg = rgb[bg_index[0][band], bg_index[1][band]].astype(np.float32)
            prior = rgb[fg_index[0][band], fg_index[1][band]].astype(np.float32)
            a = alpha[band, None]
            regularizer = 0.12
            recovered = (a * (observed - (1 - a) * old_bg) + regularizer * prior) / (a * a + regularizer)
            delta = np.clip(recovered - observed, -48, 48)
            corrected[band] = np.uint8(np.rint(np.clip(observed + delta, 0, 255)))
            count = int(np.any(corrected != rgb, axis=-1).sum())
    rgba = np.dstack((corrected, alpha_bytes))
    return Image.fromarray(rgba, "RGBA"), {"edgePixelsChanged": count, "edgeBandPixels": 4, "maxChannelCorrection": 48}


def composite_subject(subject: Image.Image, background: Image.Image) -> Image.Image:
    if subject.size != background.size:
        raise ValueError("Subject and background sizes differ.")
    return Image.alpha_composite(background.convert("RGBA"), subject.convert("RGBA")).convert("RGB")
