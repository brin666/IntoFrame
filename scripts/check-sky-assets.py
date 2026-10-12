"""Audit real generated files for edit protection and native/render consistency."""
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from atmosphere import harmonize_layer, LAYER_HARMONIZATION_VERSION
ids = set()
for manifest in sys.argv[1:]:
    records = json.loads(Path(manifest).read_text(encoding="utf8"))
    ids.update(record["id"] for record in records)
report = []
for job_id in sorted(ids):
    folder = root / "backend" / "data" / job_id
    if not (folder / "source.webp").is_file():
        continue  # An explicitly failed segmentation has no generated assets.
    source = np.asarray(Image.open(folder / "source.webp").convert("RGB"))
    alpha = np.asarray(Image.open(folder / "mask.png"))
    editable = np.asarray(Image.open(folder / "editable-sky.png"))
    assert np.all(editable[alpha >= 2] == 0), "Subject pixels entered the edit mask"
    for metadata in sorted((folder / "styles").rglob("metadata.json")):
        meta = json.loads(metadata.read_text(encoding="utf8"))
        target = metadata.parent
        style = meta["style"]
        treatment = meta.get("metrics", {}).get("layerHarmonizationVersion", "unchanged")
        assert treatment in ("unchanged", LAYER_HARMONIZATION_VERSION), "Unknown RGB treatment"
        expected_source = source if treatment == "unchanged" else np.asarray(
            harmonize_layer(Image.fromarray(source, "RGB"), style))
        native = np.asarray(Image.open(target / "background.webp").convert("RGB"))
        padded = np.asarray(Image.open(target / "render-background.webp"))
        h, w = source.shape[:2]
        px, py = max(12, round(w * .06)), max(12, round(h * .06))
        assert np.array_equal(padded[py:py+h, px:px+w], native), "Padded/native RGB differ"
        subject = np.asarray(Image.open(target / "subject.png"))
        assert np.array_equal(subject[..., 3], alpha), "Subject alpha changed"
        assert np.array_equal(subject[alpha == 255, :3], expected_source[alpha == 255]), "Opaque subject differs from declared RGB curve"
        visible_non_sky = (editable == 0) & (alpha == 0)
        assert np.array_equal(native[visible_non_sky], expected_source[visible_non_sky]), "Visible non-sky differs from declared RGB curve"
        scene = Image.open(target / "render-scene.png").convert("RGBA")
        sky = Image.open(target / "render-sky.webp").convert("RGBA")
        combined = np.asarray(Image.alpha_composite(sky, scene).convert("RGB"))
        assert np.array_equal(combined, padded), "Dynamic layers disagree with flattened background"
        report.append({"id": job_id, "style": style,
                       "atmosphereVersion": meta.get("atmosphereVersion", "original"),
                       "rgbTreatment": treatment,
                       "protectedNonSkyPixels": int(visible_non_sky.sum()),
                       "protectedOpaqueSubjectPixels": int((alpha == 255).sum()),
                       "nativeAndPaddedExact": True, "layersAndFlattenedExact": True})
assert report, "No generated results found to audit"
out = root / "screenshots" / "sky-asset-audit.json"
out.write_text(json.dumps(report, indent=2), encoding="utf8")
print(json.dumps(report, indent=2))
