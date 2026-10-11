"""Prepare local-only real sky and no-sky regression inputs (never published)."""

from io import BytesIO
from pathlib import Path
import urllib.request
from PIL import Image
from skimage import data

root = Path(__file__).resolve().parents[1] / "backend" / "data"
folder = root / "sky-inputs"
folder.mkdir(parents=True, exist_ok=True)
photos = {
    "outdoor-person": "https://images.unsplash.com/photo-1589869024358-6874d0915b82?w=1600&q=85&fit=max",
    "portrait-sky": "https://images.unsplash.com/photo-1744009549303-27a4a137031c?w=1600&q=85&fit=max",
    "street-sky": "https://images.unsplash.com/photo-1585180636375-a12724686c0f?w=1600&q=85&fit=max",
}
for name, url in photos.items():
    target = folder / f"{name}.png"
    if not target.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "IntoFrame-local-evaluation/0.1"})
        with urllib.request.urlopen(request, timeout=60) as response:
            Image.open(BytesIO(response.read())).convert("RGB").save(target)
    print(target)
Image.fromarray(data.rocket()).save(folder / "scene-rocket.png")
smoke = root / "smoke"
smoke.mkdir(exist_ok=True)
for name, filename in (("coffee", "object_coffee"), ("chelsea", "pet_chelsea")):
    Image.fromarray(getattr(data, name)()).save(smoke / f"{filename}_source.webp", lossless=True)
