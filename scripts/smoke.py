"""End-to-end local sample run for the stage 1 image pipeline.

Uses the three standard scikit-image sample images, not a simulated AI result.
"""

from __future__ import annotations

import io
import time
from pathlib import Path

import requests
from PIL import Image
from skimage import data

BASE_URL = "http://127.0.0.1:8000"
SAMPLES = {"person_astronaut": data.astronaut, "pet_chelsea": data.chelsea, "object_coffee": data.coffee}
OUTPUT = Path(__file__).resolve().parents[1] / "backend" / "data" / "smoke"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    print("health:", requests.get(f"{BASE_URL}/api/health", timeout=10).json(), flush=True)
    for name, get_sample in SAMPLES.items():
        original = Image.fromarray(get_sample()).convert("RGB")
        buffer = io.BytesIO()
        original.save(buffer, format="PNG")
        started = time.monotonic()
        response = requests.post(
            f"{BASE_URL}/api/jobs",
            files={"file": (f"{name}.png", buffer.getvalue(), "image/png")},
            timeout=30,
        )
        response.raise_for_status()
        job_id = response.json()["id"]
        for _ in range(600):
            job = requests.get(f"{BASE_URL}/api/jobs/{job_id}", timeout=10).json()
            if job["status"] != "processing":
                break
            time.sleep(1)
        else:
            raise TimeoutError(f"{name}: exceeded 10-minute processing timeout")
        elapsed = time.monotonic() - started
        if job["status"] == "failed":
            print(f"{name}: FAILED after {elapsed:.1f}s: {job['error']}", flush=True)
            continue
        result = job["result"]
        for label in ("source", "mask", "subject"):
            payload = requests.get(f"{BASE_URL}{result[label + 'Url']}", timeout=30)
            payload.raise_for_status()
            suffix = ".webp" if label == "source" else ".png"
            (OUTPUT / f"{name}_{label}{suffix}").write_bytes(payload.content)
            with Image.open(io.BytesIO(payload.content)) as image:
                assert image.size == (result["width"], result["height"])
        print(f"{name}: OK {result['width']}×{result['height']} in {elapsed:.1f}s; bounds={result['subjectBounds']}", flush=True)


if __name__ == "__main__":
    main()
