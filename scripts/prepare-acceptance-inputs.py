"""Prepare licensed test samples and optional private local building input."""

import argparse
import json
from pathlib import Path

from PIL import Image
from skimage import data

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bigben", type=Path, help="optional local building photo; never marked publishable")
    parser.add_argument("--person", type=Path, help="local outdoor person + visible sky sample")
    args = parser.parse_args()
    folder = ROOT / "backend" / "data" / "acceptance-inputs"
    folder.mkdir(parents=True, exist_ok=True)
    records = []
    if args.person:
        if not args.person.is_file():
            parser.error("The person input does not exist")
        records.append({"label": "outdoor-person", "path": str(args.person.resolve()), "publicAllowed": False,
                        "expectedSky": True, "styles": ["dreamy-pink"]})
    if args.bigben:
        if not args.bigben.is_file():
            parser.error("The building input does not exist")
        records.append({"label": "bigben", "path": str(args.bigben.resolve()), "publicAllowed": False,
                        "styles": ["dreamy-pink", "golden-hour", "cinematic-night"]})
    for name, style in (("astronaut", "dreamy-pink"), ("chelsea", "dreamy-pink"), ("coffee", "golden-hour")):
        image_path = folder / f"{name}.png"
        Image.fromarray(getattr(data, name)()).save(image_path)
        records.append({"label": name, "path": str(image_path), "publicAllowed": True,
                        "expectedSky": False, "styles": [style]})
    (folder.parent / "acceptance-inputs.json").write_text(json.dumps(records, indent=2), encoding="utf8")
    print("Prepared licensed samples and local-only input configuration.")


if __name__ == "__main__":
    main()
