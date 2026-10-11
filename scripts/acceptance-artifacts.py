"""Create comparison sheets and numeric evidence from real browser artifacts."""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt


def sheet(items, destination, cell=(460, 560)):
    width, height = cell
    output = Image.new("RGB", (width * len(items), height), (18, 20, 22))
    draw = ImageDraw.Draw(output)
    for index, (label, image) in enumerate(items):
        image = image.convert("RGB").copy()
        scale = min((width - 16) / image.width, (height - 40) / image.height)
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
        output.paste(image, (width * index + (width - image.width) // 2, 32))
        draw.text((width * index + 8, 10), label, fill=(230, 230, 230))
    output.save(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", nargs="?", default="after")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / "screenshots" / "acceptance" / args.phase
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf8"))
    report = []
    regions = {
        "bigben": {"tip": (580, 0, 810, 270), "right-eaves": (970, 650, 1130, 1080), "left-wall": (280, 1040, 420, 1400), "base": (280, 1390, 1100, 1600)},
        "astronaut": {"hair": (130, 0, 300, 145), "shoulder": (70, 190, 155, 335)},
        "chelsea": {"fur-ear": (250, 0, 451, 165), "whiskers": (0, 110, 220, 250)},
        "coffee": {"cup-and-spoon": (250, 30, 540, 230)},
    }
    for case in manifest["cases"]:
        for style in case["styles"]:
            folder = root / case["label"] / style["style"]
            source = Image.open(folder / "source.webp").convert("RGB")
            source.save(folder / "source.png")
            background = Image.open(folder / "background.webp").convert("RGB")
            background.save(folder / "background.png")
            mask = np.asarray(Image.open(folder / "mask.png"))
            original = Image.open(folder / "subject.png").convert("RGBA")
            subject = Image.open(folder / "styledSubject.png").convert("RGBA")
            before = Image.alpha_composite(background.convert("RGBA"), original).convert("RGB")
            after = Image.open(folder / "composite.png").convert("RGB")
            before.save(folder / "same-background-old-edges.png")
            export = Image.open(folder / "export.png").convert("RGB")
            preview = Image.open(folder / "preview-after.png").convert("RGB")
            rgba = np.asarray(subject)
            delta = rgba[..., :3].astype(int) - np.asarray(source).astype(int)
            changed = np.any(delta != 0, axis=-1)
            distance = distance_transform_edt(mask > 2)
            difference = np.abs(np.asarray(export.resize(preview.size, Image.Resampling.BILINEAR)).astype(float) - np.asarray(preview).astype(float))
            stats = {
                "input": case["label"], "style": style["style"], "processedSize": list(source.size),
                "model": style["model"], "metrics": style["metrics"], "commit": manifest["commit"],
                "opaquePixels": int((mask == 255).sum()),
                "opaqueChanged": int(np.any(delta[mask == 255] != 0, axis=-1).sum()),
                "alphaChanged": int((rgba[..., 3] != mask).sum()),
                "edgeChangedPixels": int(changed.sum()), "maxChannelCorrection": int(np.abs(delta).max()),
                "changesOutsideBand": int((changed & ((distance > 4) | (mask <= 2) | (mask >= 250))).sum()),
                "previewVsExportMAE": round(float(difference.mean()), 3),
                "previewVsExportP95": round(float(np.percentile(difference, 95)), 3),
                "barHeightDifference": abs(style["geometry"]["topBar"] - style["geometry"]["bottomBar"]),
                "backgroundMode": style["geometry"]["backgroundMode"],
                "exportCorners": [export.getpixel(p) for p in ((0, 0), (export.width-1, 0), (0, export.height-1), (export.width-1, export.height-1))],
            }
            assert stats["opaqueChanged"] == stats["alphaChanged"] == stats["changesOutsideBand"] == 0, stats
            assert stats["maxChannelCorrection"] <= 48 and stats["barHeightDifference"] < 0.1, stats
            assert stats["backgroundMode"] in {"sky-plane", "sky-layers"}, stats
            report.append(stats)
            for name, bounds in regions.get(case["label"], {}).items():
                sheet([("Old edges / same background", before.crop(bounds)), ("Recovered edges / same alpha", after.crop(bounds))], folder / f"edge-{name}-compare.png", (440, 500))
            sheet([("Original preview", Image.open(folder / "preview-before.png")), ("Generated preview", preview)], folder / "before-after.png", (520, 650))
            sheet([("Browser centered preview", preview), ("Centered PNG export", export)], folder / "preview-export.png", (520, 650))
            sheet([("Processed original", source), ("Generated sky", background), ("Composite without bars", after), ("Browser PNG export", export)], folder / "pipeline.png", (440, 560))
    (root / "numeric-evidence.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    if any(case["label"] == "bigben" for case in manifest["cases"]):
        b = root / "bigben"
        sheet([("Original preview", Image.open(b / "dreamy-pink/preview-before.png")),
               ("Dreamy Pink", Image.open(b / "dreamy-pink/preview-after.png")),
               ("Golden Hour", Image.open(b / "golden-hour/preview-after.png")),
               ("Night / stylized", Image.open(b / "cinematic-night/preview-after.png"))], root / "bigben-three-styles.png", (500, 650))
    print(json.dumps([{k: row[k] for k in ("input", "style", "opaqueChanged", "alphaChanged", "edgeChangedPixels", "previewVsExportMAE", "previewVsExportP95", "barHeightDifference")} for row in report], indent=2))


if __name__ == "__main__":
    main()
