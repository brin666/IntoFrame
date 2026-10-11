"""Freeze the actual failing assets; inspect layers without generating new sky."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from sky_detector import _load_model, sky_mask_from_logits

JOB = "3534dba305414eb8ba733552b565edd9"
OUT = ROOT / "screenshots" / "edge-repair"
FROZEN = OUT / "before"


def main():
    FROZEN.mkdir(parents=True, exist_ok=True)
    folder = ROOT / "backend" / "data" / JOB
    # Never overwrite the frozen before state on subsequent diagnostic runs.
    for path in folder.rglob("*"):
        if path.is_file():
            target = FROZEN / path.relative_to(folder)
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.copy2(path, target)
    screenshot = Path(r"C:\Users\BL\AppData\Local\Temp\codex-clipboard-75137fea-d5de-42f1-9a15-78f38a2b6df0.png")
    if screenshot.exists() and not (OUT / "user-failure.png").exists():
        shutil.copy2(screenshot, OUT / "user-failure.png")
    manifest_path = OUT / "frozen-manifest.json"
    if not manifest_path.exists():
        manifest = {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                    "worktree": subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True),
                    "jobId": JOB, "style": "cinematic-night", "rawSemanticStatus": "not retained by baseline; recomputed below with same pinned CPU model/source",
                    "files": {str(p.relative_to(FROZEN)): hashlib.sha256(p.read_bytes()).hexdigest() for p in FROZEN.rglob("*") if p.is_file()}}
        for kind, endpoint in [("job", "jobs"), ("depth", "depth"), ("style", "restyle")]:
            url = f"http://127.0.0.1:5190/api/{endpoint}/{JOB}" + ("/cinematic-night" if kind == "style" else "")
            manifest[kind] = json.load(urllib.request.urlopen(url))
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf8")
    source = Image.open(FROZEN / "source.webp").convert("RGB")
    alpha = Image.open(FROZEN / "mask.png").convert("L")
    style = FROZEN / "styles" / "cinematic-night"
    rgba = Image.open(style / "subject.png").convert("RGBA")
    panels = [("Original", source), ("BiRefNet alpha", alpha.convert("RGB"))]
    for color, name in [(0, "Subject on black"), (128, "Subject on gray")]:
        isolated = Image.alpha_composite(Image.new("RGBA", source.size, (color, color, color, 255)), rgba).convert("RGB")
        isolated.save(OUT / f"{name.lower().replace(' ', '-')}.png")
        panels.append((name, isolated))
    editable = Image.open(FROZEN / "editable-sky.png").convert("L")
    px, py = 86, 96
    scene = Image.open(style / "render-scene.png").crop((px, py, px + source.width, py + source.height))
    sky = Image.open(style / "render-sky.webp").crop((px, py, px + source.width, py + source.height)).convert("RGB")
    sky.save(OUT / "frozen-generated-sky.png")
    scene.save(OUT / "preserved-scene-before.png")
    scene.getchannel("A").save(OUT / "preserved-scene-weight-before.png")
    panels += [("Editable sky (baseline)", editable.convert("RGB")), ("Preserved layer / gray", Image.alpha_composite(Image.new("RGBA", source.size, (128,128,128,255)), scene).convert("RGB")), ("Sky + scene, subject hidden", Image.alpha_composite(sky.convert("RGBA"), scene).convert("RGB")), ("Final before", Image.open(style / "composite.png").convert("RGB"))]
    # Pure-sky historical control only; use the SAME generated sky and alpha.
    Image.alpha_composite(sky.convert("RGBA"), rgba).convert("RGB").save(OUT / "all-background-replaced-control.png")
    raw = OUT / "semantic-recomputed.npz"
    if not raw.exists():
        import torch
        processor, model = _load_model()
        with torch.inference_mode():
            logits = model(**processor(images=source, return_tensors="pt")).logits[0].float().numpy()
        exp = np.exp(logits - logits.max(axis=0))
        np.savez_compressed(raw, logits=logits, probability=exp[2] / exp.sum(axis=0), labels=logits.argmax(axis=0))
    with np.load(raw) as data:
        original_mask, _ = sky_mask_from_logits(data["logits"], alpha)
        Image.fromarray(np.uint8(data["probability"] * 255)).resize(source.size).save(OUT / "sky-probability-recomputed.png")
        Image.fromarray(np.uint8(data["labels"] == 2) * 255).resize(source.size, Image.Resampling.NEAREST).save(OUT / "sky-argmax-recomputed.png")
        equal = np.array_equal(np.asarray(original_mask), np.asarray(editable))
    # Sample known light-blue patch at the right slope (native coordinates).
    points = [(759,325), (835,525), (894,651), (930,645), (720,650)]
    stats = {"semanticReplayByteEqual": equal, "samples": []}
    for x,y in points:
        stats["samples"].append({"xy":[x,y], "source":list(source.getpixel((x,y))), "alpha":alpha.getpixel((x,y)), "editable":editable.getpixel((x,y)), "scene":list(scene.getpixel((x,y))), "final":list(Image.open(style / "composite.png").getpixel((x,y)))})
    (OUT / "diagnosis.json").write_text(json.dumps(stats, indent=2), encoding="utf8")
    w, h = 356, 400
    grid = Image.new("RGB", (w*4, (h+28)*2), (24,24,24))
    draw = ImageDraw.Draw(grid)
    for i,(label,picture) in enumerate(panels):
        x,y=(i%4)*w,(i//4)*(h+28)
        draw.text((x+7,y+7), label, fill="white")
        grid.paste(picture.resize((w,h)), (x,y+28))
    grid.save(OUT / "diagnostic-layers.png")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
