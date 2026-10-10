"""Exercise segmentation, depth, and render asset contracts on three real samples."""

from __future__ import annotations

import io
import time

import numpy as np
import requests
from PIL import Image
from skimage import data

BASE = "http://127.0.0.1:8000"
SAMPLES = {"person": data.astronaut, "pet": data.chelsea, "object": data.coffee}


def wait(path: str) -> dict:
    for _ in range(600):
        response = requests.get(f"{BASE}{path}", timeout=15)
        response.raise_for_status()
        job = response.json()
        if job["status"] != "processing":
            return job
        time.sleep(1)
    raise TimeoutError(path)


def main() -> None:
    for name, sample in SAMPLES.items():
        image = Image.fromarray(sample()).convert("RGB")
        payload = io.BytesIO()
        image.save(payload, "PNG")
        started = time.monotonic()
        response = requests.post(f"{BASE}/api/jobs", files={"file": (f"{name}.png", payload.getvalue(), "image/png")}, timeout=30)
        response.raise_for_status()
        job_id = response.json()["id"]
        job = wait(f"/api/jobs/{job_id}")
        if job["status"] != "complete":
            raise RuntimeError(f"{name} segmentation: {job}")
        segmented = time.monotonic() - started
        response = requests.post(f"{BASE}/api/depth", json={"jobId": job_id}, timeout=30)
        response.raise_for_status()
        job = wait(f"/api/depth/{job_id}")
        if job["status"] != "complete":
            raise RuntimeError(f"{name} depth: {job}")
        result = job["result"]
        for key, size in (("depthUrl", (result["width"], result["height"])), ("renderDepthUrl", (result["renderWidth"], result["renderHeight"])), ("backgroundUrl", (result["renderWidth"], result["renderHeight"]))):
            asset = requests.get(f"{BASE}{result[key]}", timeout=30)
            asset.raise_for_status()
            with Image.open(io.BytesIO(asset.content)) as output:
                assert output.size == size, (name, key, output.size, size)
                if key == "depthUrl":
                    levels = np.asarray(output.convert("L"))
                    assert levels.max() - levels.min() > 20
        print(f"{name}: {job_id} {result['width']}x{result['height']}; segmentation {segmented:.1f}s, depth+fill {time.monotonic()-started-segmented:.1f}s; near range {levels.min()}-{levels.max()}, subject {result['foregroundDepth']:.2f}", flush=True)


if __name__ == "__main__":
    main()
