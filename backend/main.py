"""Local image processing API. Job state stays in memory for the hackathon MVP."""

from __future__ import annotations

import asyncio
import io
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError

from segmenter import MODEL_ID, segment

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
MAX_UPLOAD = 20 * 1024 * 1024
MAX_SIDE = 1600
jobs: dict[str, dict] = {}
semaphore = asyncio.Semaphore(1)

app = FastAPI(title="IntoFrame API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5187", "http://localhost:5187"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory=DATA), name="media")


def _prepare_image(raw: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(raw))
        if image.format not in {"JPEG", "PNG", "WEBP"}:
            raise ValueError("Only JPG, PNG and WebP images are supported.")
        if image.width < 128 or image.height < 128:
            raise ValueError("Image must be at least 128 × 128 pixels.")
        if image.width * image.height > 40_000_000:
            raise ValueError("Image dimensions are too large (40 megapixels max).")
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
        image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
        return image
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("The image could not be decoded. Try another JPG, PNG or WebP file.") from exc


def _bounds(mask: Image.Image) -> tuple[int, int, int, int]:
    # Use a modest alpha threshold so translucent edge noise cannot define the subject.
    binary = mask.point(lambda value: 255 if value >= 35 else 0)
    bbox = binary.getbbox()
    if bbox is None:
        raise ValueError("No clear main subject was found. Try a photo with a distinct foreground.")
    area = sum(1 for value in binary.getdata() if value) / (mask.width * mask.height)
    if area < 0.015 or area > 0.90:
        raise ValueError("The subject mask is too small or covers nearly the whole photo. Try another image.")
    return bbox


def _process(job_id: str, image: Image.Image) -> dict:
    jobs[job_id]["stage"] = "segmenting"
    mask = segment(image)
    if mask.size != image.size:
        raise RuntimeError("Segmentation returned a mask with the wrong dimensions.")
    bbox = _bounds(mask)
    folder = DATA / job_id
    folder.mkdir()
    image.save(folder / "source.webp", "WEBP", quality=92, method=4)
    mask.save(folder / "mask.png")
    foreground = image.copy().convert("RGBA")
    foreground.putalpha(mask)
    foreground.save(folder / "subject.png")
    width, height = image.size
    left, top, right, bottom = bbox
    subject_height = (bottom - top) / height
    touches_top = top <= height * 0.02
    touches_bottom = bottom >= height * 0.98
    composition_notice = (
        "The subject touches the photo edge. A wider original shot will make a cleaner break."
        if touches_top and touches_bottom else None
    )
    # Center the subject around the upper third and make its head approach the top bar.
    scale = min(1.65, max(1.0, 0.58 / max(subject_height, 0.01)))
    cx = (left + right) / (2 * width)
    cy = (top + bottom) / (2 * height)
    return {
        "id": job_id,
        "width": width, "height": height,
        "subjectBounds": [left, top, right, bottom],
        "composition": {"scale": round(scale, 3), "focusX": round(cx, 4), "focusY": round(cy, 4)},
        "compositionNotice": composition_notice,
        "sourceUrl": f"/media/{job_id}/source.webp",
        "maskUrl": f"/media/{job_id}/mask.png",
        "subjectUrl": f"/media/{job_id}/subject.png",
        "model": MODEL_ID,
    }


async def _run_job(job_id: str, image: Image.Image) -> None:
    async with semaphore:
        try:
            jobs[job_id]["stage"] = "preparing"
            result = await asyncio.to_thread(_process, job_id, image)
            jobs[job_id] = {"status": "complete", "stage": "complete", "result": result}
        except Exception as exc:
            # Do not expose local paths or model internals through the public API.
            message = str(exc)
            if not isinstance(exc, (ValueError, RuntimeError)):
                message = "AI processing failed. Check the backend log and try another photo."
            jobs[job_id] = {"status": "failed", "stage": "failed", "error": message}
            print(f"Job {job_id} failed: {exc!r}", flush=True)


@app.get("/api/health")
def health():
    return {"status": "ok", "model": MODEL_ID, "cudaRequired": True}


@app.post("/api/jobs", status_code=202)
async def create_job(file: UploadFile = File(...)):
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "Upload a JPG, PNG or WebP image.")
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "Image is larger than 20 MB.")
    try:
        image = _prepare_image(raw)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    job_id = uuid.uuid4().hex
    jobs[job_id] = {"status": "processing", "stage": "queued"}
    asyncio.create_task(_run_job(job_id, image))
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found. Upload the image again.")
    return jobs[job_id]
