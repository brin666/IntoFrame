"""Export the pinned Depth Anything V2 prediction as little-endian float32.

This is an opt-in experiment artifact. The production depth.png/API are unchanged.
Run from the repository root with the project's Python 3.11 virtual environment.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from depth_estimator import MODEL_ID, MODEL_REVISION, _load_model  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", help="existing backend/data job ID")
    args = parser.parse_args()
    folder = ROOT / "backend" / "data" / args.job
    source_path = folder / "source.webp"
    mask_path = folder / "mask.png"
    if not source_path.is_file() or not mask_path.is_file():
        parser.error("The job must already have source.webp and mask.png")

    import torch

    with Image.open(source_path) as source_file, Image.open(mask_path) as mask_file:
        source = source_file.convert("RGB")
        mask = np.asarray(mask_file.convert("L"))
    if mask.shape != (source.height, source.width):
        raise RuntimeError("Source and mask dimensions differ")

    processor, model = _load_model()
    inputs = processor(images=source, return_tensors="pt").to("cuda")
    with torch.inference_mode():
        predicted = model(**inputs).predicted_depth
        depth = torch.nn.functional.interpolate(
            predicted.unsqueeze(1), size=(source.height, source.width),
            mode="bicubic", align_corners=False,
        )[0, 0].float().cpu().numpy()
    if not np.isfinite(depth).all():
        raise RuntimeError("Depth prediction contains non-finite values")

    # The binary contract is row-major, native source resolution, float32 little-endian.
    depth.astype("<f4", copy=False).tofile(folder / "subject-depth-f32.bin")
    subject_values = depth[mask > 160]
    if subject_values.size == 0:
        raise RuntimeError("Mask has no subject pixels")
    metadata = {
        "width": source.width, "height": source.height,
        "encoding": "float32-little-endian-row-major",
        "model": MODEL_ID, "revision": MODEL_REVISION,
        "source": "source.webp", "mask": "mask.png",
        "nearDirection": "larger-prediction-is-nearer",
        "subjectP05": float(np.percentile(subject_values, 5)),
        "subjectP95": float(np.percentile(subject_values, 95)),
        "globalMin": float(depth.min()), "globalMax": float(depth.max()),
    }
    (folder / "subject-depth.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
