"""Local image processing API. Job state stays in memory for the hackathon MVP."""

from __future__ import annotations

import asyncio
import io
import json
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel

from depth_estimator import MODEL_ID as DEPTH_MODEL_ID, estimate, prepare_render_assets
from depth_estimator import OVERSCAN_FRACTION
from restyler import MODEL_ID as RESTYLE_MODEL_ID, STYLES, restyle
from compositing import composite_subject, recover_subject_edges
from segmenter import MODEL_ID, segment
from sky_detector import detect_sky, MODEL_ID as SKY_MODEL_ID
from sky_compositing import build_sky_layers

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
MAX_UPLOAD = 20 * 1024 * 1024
MAX_SIDE = 1600
jobs: dict[str, dict] = {}
depth_jobs: dict[str, dict] = {}
restyle_jobs: dict[tuple[str, str], dict] = {}
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
    # One lossless canonical RGB avoids a second lossy subject copy in restyling.
    image.save(folder / "source.webp", "WEBP", lossless=True, method=4)
    mask.save(folder / "mask.png")
    foreground = image.copy().convert("RGBA")
    foreground.putalpha(mask)
    foreground.save(folder / "subject.png")
    jobs[job_id]["stage"] = "checking-sky"
    try:
        editable_sky, sky = detect_sky(image, mask)
    except RuntimeError:
        editable_sky = Image.new("L", image.size, 0)
        sky = {"eligible": False, "status": "unavailable", "skyFraction": 0,
               "model": SKY_MODEL_ID,
               "reason": "Sky analysis is unavailable. Check the local model setup and upload again."}
    editable_sky.save(folder / "editable-sky.png")
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
        "subjectStats": _subject_stats(mask),
        "sky": {**sky, "bounds": editable_sky.getbbox(), "maskUrl": f"/media/{job_id}/editable-sky.png"},
        "composition": {"scale": round(scale, 3), "focusX": round(cx, 4), "focusY": round(cy, 4)},
        "compositionNotice": composition_notice,
        "sourceUrl": f"/media/{job_id}/source.webp",
        "maskUrl": f"/media/{job_id}/mask.png",
        "subjectUrl": f"/media/{job_id}/subject.png",
        "model": MODEL_ID,
    }


def _subject_stats(mask: Image.Image) -> dict:
    alpha = np.asarray(mask.convert("L"))
    edge_width = max(1, round(mask.width * 0.01))
    return {
        "occupancy": round(float((alpha >= 35).mean()), 5),
        "leftEdgeFraction": round(float((alpha[:, :edge_width] >= 160).any(axis=1).mean()), 5),
        "rightEdgeFraction": round(float((alpha[:, -edge_width:] >= 160).any(axis=1).mean()), 5),
    }


class DepthRequest(BaseModel):
    jobId: str


class RestyleRequest(BaseModel):
    jobId: str
    style: str


def _process_restyle(job_id: str, style: str) -> dict:
    folder = DATA / job_id
    target = folder / "styles" / style
    target.mkdir(parents=True, exist_ok=True)
    with Image.open(folder / "source.webp") as source_file:
        source = source_file.convert("RGB")
    with Image.open(folder / "mask.png") as mask_file:
        mask = mask_file.convert("L")
    with Image.open(folder / "editable-sky.png") as sky_file:
        editable_sky = sky_file.convert("L")
    if not editable_sky.getbbox():
        raise ValueError("No editable sky was detected. Choose an outdoor photo with visible sky.")
    restyle_jobs[(job_id, style)]["stage"] = "generating"
    generated_sky, _, metrics = restyle(source, mask, style)
    background, preserved_scene, sky_underlay = build_sky_layers(source, mask, editable_sky, generated_sky)
    restyle_jobs[(job_id, style)]["stage"] = "compositing"
    subject, edge_metrics = recover_subject_edges(source, mask, sky_underlay)
    composite = composite_subject(subject, background)
    # Preview, padded texture, composite and export must share identical RGB.
    background.save(target / "background.webp", "WEBP", lossless=True, method=4)
    subject.save(target / "subject.png", "PNG", optimize=True)
    composite.save(target / "composite.png", "PNG", optimize=True)
    pad_x = max(12, round(source.width * OVERSCAN_FRACTION))
    pad_y = max(12, round(source.height * OVERSCAN_FRACTION))
    padded = cv2.copyMakeBorder(
        np.asarray(background), pad_y, pad_y, pad_x, pad_x, cv2.BORDER_REFLECT_101
    )
    Image.fromarray(padded, "RGB").save(
        target / "render-background.webp", "WEBP", lossless=True, method=4
    )
    for name, layer in (("render-sky.webp", generated_sky), ("render-scene.png", preserved_scene)):
        padded_layer = cv2.copyMakeBorder(np.asarray(layer), pad_y, pad_y, pad_x, pad_x, cv2.BORDER_REFLECT_101)
        output = Image.fromarray(padded_layer)
        if name.endswith("webp"):
            output.save(target / name, "WEBP", lossless=True, method=4)
        else:
            output.save(target / name, "PNG", optimize=True)
    sky_underlay.save(target / "sky-underlay.png")
    root_url = f"/media/{job_id}/styles/{style}"
    result = {
        "jobId": job_id,
        "style": style,
        "backgroundUrl": f"{root_url}/background.webp",
        "renderBackgroundUrl": f"{root_url}/render-background.webp",
        "compositeUrl": f"{root_url}/composite.png",
        "subjectUrl": f"{root_url}/subject.png",
        "renderSkyUrl": f"{root_url}/render-sky.webp",
        "renderSceneUrl": f"{root_url}/render-scene.png",
        "editableSkyUrl": f"/media/{job_id}/editable-sky.png",
        "backgroundGeometry": "sky-layers",
        "model": RESTYLE_MODEL_ID,
        "metrics": {**metrics, **edge_metrics},
    }
    (target / "metadata.json").write_text(json.dumps(result, indent=2), encoding="utf8")
    return result


async def _run_restyle(job_id: str, style: str) -> None:
    key = (job_id, style)
    async with semaphore:
        try:
            restyle_jobs[key]["stage"] = "loading-model"
            result = await asyncio.to_thread(_process_restyle, job_id, style)
            restyle_jobs[key] = {"status": "complete", "stage": "complete", "result": result}
        except Exception as exc:
            message = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "AI background generation failed. Check the backend log."
            restyle_jobs[key] = {"status": "failed", "stage": "failed", "error": message}
            print(f"Restyle job {job_id}/{style} failed: {exc!r}", flush=True)


def _process_depth(job_id: str) -> dict:
    folder = DATA / job_id
    with Image.open(folder / "source.webp") as source_file:
        source = source_file.convert("RGB")
    with Image.open(folder / "mask.png") as mask_file:
        mask = mask_file.convert("L")
    depth_jobs[job_id]["stage"] = "estimating"
    depth = estimate(source)
    depth_jobs[job_id]["stage"] = "filling"
    background, render_depth, foreground_depth, padding = prepare_render_assets(source, mask, depth)
    depth.save(folder / "depth.png")
    render_depth.save(folder / "render-depth.png")
    background.save(folder / "background.webp", "WEBP", quality=91, method=4)
    return {
        "jobId": job_id,
        "width": source.width,
        "height": source.height,
        "renderWidth": background.width,
        "renderHeight": background.height,
        "padding": padding,
        "foregroundDepth": round(foreground_depth, 4),
        "encoding": "uint8-png-near-white",
        "depthUrl": f"/media/{job_id}/depth.png",
        "renderDepthUrl": f"/media/{job_id}/render-depth.png",
        "backgroundUrl": f"/media/{job_id}/background.webp",
        "model": DEPTH_MODEL_ID,
        "backgroundMethod": "OpenCV Telea local inpaint",
    }


async def _run_depth(job_id: str) -> None:
    async with semaphore:
        try:
            result = await asyncio.to_thread(_process_depth, job_id)
            depth_jobs[job_id] = {"status": "complete", "stage": "complete", "result": result}
        except Exception as exc:
            message = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Depth processing failed. Check the backend log."
            depth_jobs[job_id] = {"status": "failed", "stage": "failed", "error": message}
            print(f"Depth job {job_id} failed: {exc!r}", flush=True)


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


@app.post("/api/depth", status_code=202)
async def create_depth(request: DepthRequest):
    job = jobs.get(request.jobId)
    if job is None:
        raise HTTPException(404, "Source job not found. Upload the image again.")
    if job["status"] != "complete":
        raise HTTPException(409, "Source segmentation must complete before depth processing.")
    if request.jobId not in depth_jobs:
        depth_jobs[request.jobId] = {"status": "processing", "stage": "queued"}
        asyncio.create_task(_run_depth(request.jobId))
    return {"id": request.jobId, "status": depth_jobs[request.jobId]["status"]}


@app.get("/api/depth/{job_id}")
def get_depth(job_id: str):
    if job_id not in depth_jobs:
        raise HTTPException(404, "Depth job not found. Start it with POST /api/depth.")
    return depth_jobs[job_id]


@app.post("/api/restyle", status_code=202)
async def create_restyle(request: RestyleRequest):
    job = jobs.get(request.jobId)
    if job is None or job["status"] != "complete":
        raise HTTPException(404, "Source photo is unavailable. Upload it again.")
    if request.style not in STYLES:
        raise HTTPException(422, "Choose a supported background style.")
    sky = job.get("result", {}).get("sky", {})
    if not sky.get("eligible"):
        raise HTTPException(422, sky.get("reason") or "No editable sky detected. Upload an outdoor photo with visible sky.")
    key = (request.jobId, request.style)
    if key not in restyle_jobs or restyle_jobs[key]["status"] == "failed":
        restyle_jobs[key] = {"status": "processing", "stage": "queued"}
        asyncio.create_task(_run_restyle(*key))
    return {"id": request.jobId, "style": request.style, "status": restyle_jobs[key]["status"]}


@app.get("/api/restyle/{job_id}/{style}")
def get_restyle(job_id: str, style: str):
    key = (job_id, style)
    if key not in restyle_jobs:
        raise HTTPException(404, "Style job not found. Generate it first.")
    return restyle_jobs[key]
