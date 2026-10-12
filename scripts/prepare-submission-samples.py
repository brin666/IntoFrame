"""Generate real, publishable IntoFrame samples from public source photos.

This deliberately uses the running HTTP API for upload, depth, and all three
restyle styles. The ignored evidence directory stores raw API responses; only
the allow-listed media URL resources are copied into public/samples.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "samples"
EVIDENCE = ROOT / "screenshots" / "submission-samples"
STYLES = ("dreamy-pink", "golden-hour", "cinematic-night")
ATMOSPHERE_VERSION = "sky-scene-ambience-v2"
MAX_SIDE = 1024
POLL_SECONDS = 1.0
POLL_LIMIT = 900

# The public submission contains only these four verified architecture sources.
PUBLICATION_IDS = ("tower", "taipei", "flatiron", "qutub")
SAMPLE_SOURCES: dict[str, dict[str, Any]] = {
    "tower": {
        "title": "Big Ben, London",
        "category": "architecture",
        "defaultStyle": "dreamy-pink",
        "input": ROOT / "screenshots" / "submission-inputs" / "tower.jpg",
        "inputUrl": "https://upload.wikimedia.org/wikipedia/commons/0/0e/BigBenLondon.jpg",
        "inputSha256": "fb4e94ae7b3ef3b6c029def753641d706f8cf62685bf583ed96e25f57997c244",
        "downloadSha256": "fb4e94ae7b3ef3b6c029def753641d706f8cf62685bf583ed96e25f57997c244",
        "source": {
            "url": "https://commons.wikimedia.org/wiki/File:BigBenLondon.jpg",
            "author": "Massimo Catarinella",
            "license": "CC BY-SA 3.0",
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
        },
    },
    "taipei": {
        "title": "Taipei 101 in blue sky",
        "category": "architecture",
        "defaultStyle": "dreamy-pink",
        "input": ROOT / "screenshots" / "submission-inputs" / "taipei.jpg",
        "inputUrl": "https://upload.wikimedia.org/wikipedia/commons/b/b8/Taipei_101_in_blue_sky.jpg",
        "inputSha256": "934e130522eb4bbf8e6a38900fcf9b5ac78c40969715df789b875c19798d0e60",
        "downloadSha256": "934e130522eb4bbf8e6a38900fcf9b5ac78c40969715df789b875c19798d0e60",
        "source": {
            "url": "https://commons.wikimedia.org/wiki/File:Taipei_101_in_blue_sky.jpg",
            "author": "Pauloleong2002",
            "license": "CC BY-SA 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        },
    },
    "flatiron": {
        "title": "Flatiron Building, New York",
        "category": "architecture",
        "defaultStyle": "dreamy-pink",
        "input": ROOT / "screenshots" / "submission-inputs" / "flatiron.png",
        "downloadPath": ROOT / "screenshots" / "submission-inputs" / "flatiron.jpg",
        "inputUrl": "https://upload.wikimedia.org/wikipedia/commons/c/c1/The_Flatiron_Building_%287%29.jpg",
        "inputSha256": "c070fbf16df4ed6284533e6ec25ca9b53d1278221de57cc3a28d9ae9a4cd697e",
        "downloadSha256": "cd9eef20a7ce62596a7ba5be62914636b7bb0a470d8839646f73b5c56532ba05",
        "source": {
            "url": "https://commons.wikimedia.org/wiki/File:The_Flatiron_Building_(7).jpg",
            "author": "PortableNYCTours",
            "license": "CC BY-SA 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        },
    },
    "qutub": {
        "title": "Qutub Minar",
        "category": "architecture",
        "defaultStyle": "dreamy-pink",
        "input": ROOT / "screenshots" / "submission-inputs" / "qutub.png",
        "downloadPath": ROOT / "screenshots" / "submission-inputs" / "qutub.jpg",
        "inputUrl": "https://upload.wikimedia.org/wikipedia/commons/c/ca/Qutub_Minar_%2854342718682%29.jpg",
        "inputSha256": "1543a09081263cb55441ce5d2b9e88ac259f930a82715b93b51c1861ff24d087",
        "downloadSha256": "d37f516339f2f4429ac042b33bc71c90161a85f623276c342bedadf3c4de617b",
        "source": {
            "url": "https://commons.wikimedia.org/wiki/File:Qutub_Minar_(54342718682).jpg",
            "author": "Joe deSousa (Mustang Joe)",
            "license": "CC0 1.0",
            "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        },
    },
}

ALLOWED_ASSETS = {
    "source.webp",
    "mask.png",
    "subject.png",
    "editable-sky.png",
    "depth.png",
    "render-depth.png",
    "background.webp",
    "subject-depth-f32.bin",
}
ALLOWED_STYLE_ASSETS = {
    "background.webp",
    "subject.png",
    "composite.png",
    "render-background.webp",
    "render-sky.webp",
    "render-scene.png",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require_managed_child(path: Path, parent: Path, allowed_names: set[str]) -> Path:
    resolved_parent = parent.resolve()
    resolved_path = path.resolve()
    if resolved_path.parent != resolved_parent or resolved_path.name not in allowed_names:
        raise RuntimeError(f"Refusing recursive removal outside the managed sample directory: {resolved_path}")
    return resolved_path


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def request_json(base: str, path: str, payload: dict[str, Any] | None = None,
                 file_path: Path | None = None) -> tuple[Any, float, int]:
    headers: dict[str, str] = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif file_path is not None:
        boundary = f"IntoFrameSamples{uuid.uuid4().hex}"
        content = file_path.read_bytes()
        disposition = f'form-data; name="file"; filename="{file_path.name}"'
        content_type = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }.get(file_path.suffix.lower())
        if content_type is None:
            raise ValueError(f"Unsupported upload extension: {file_path.suffix}")
        data = (
            f"--{boundary}\r\nContent-Disposition: {disposition}\r\n"
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("ascii")
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    else:
        data = None
    request = urllib.request.Request(base.rstrip("/") + path, data=data, headers=headers)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            body = response.read()
            return json.loads(body), time.perf_counter() - started, response.status
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} for {path}: {detail[:1000]}") from error


def poll_json(base: str, path: str, evidence: dict[str, Any], key: str) -> dict[str, Any]:
    polls = []
    for _ in range(POLL_LIMIT):
        response, elapsed, status = request_json(base, path)
        polls.append({"httpStatus": status, "requestSeconds": round(elapsed, 3), "response": response})
        if response.get("status") != "processing":
            evidence[key] = {"polls": polls, "final": response}
            if response.get("status") != "complete" or not isinstance(response.get("result"), dict):
                raise RuntimeError(f"{path} ended in {response.get('status')}: {response.get('error')}")
            return response["result"]
        time.sleep(POLL_SECONDS)
    evidence[key] = {"polls": polls, "timeout": True}
    raise TimeoutError(f"Timed out waiting for {path}")


def prepare_input(source: dict[str, Any], input_path: Path) -> tuple[Path, dict[str, Any]]:
    input_path.parent.mkdir(parents=True, exist_ok=True)
    source_path = input_path
    downloaded = False
    if not input_path.exists():
        source_path = Path(source.get("downloadPath", input_path))
        if not source_path.is_absolute():
            source_path = ROOT / source_path
        source_path.parent.mkdir(parents=True, exist_ok=True)
    if not source_path.exists() and source.get("inputUrl"):
        request = urllib.request.Request(
            source["inputUrl"], headers={"User-Agent": "IntoFrame sample preparation/1.0"}
        )
        with urllib.request.urlopen(request, timeout=90) as response:
            source_path.write_bytes(response.read())
        downloaded = True
    if not source_path.is_file():
        raise FileNotFoundError(f"Expected original input is missing: {source_path}")

    original = source_path.read_bytes()
    source_is_original = downloaded or source_path != input_path
    expected_hash = source.get("downloadSha256" if source_is_original else "inputSha256")
    if expected_hash and sha256(original) != expected_hash:
        label = "source download" if source_is_original else "local source input"
        raise RuntimeError(f"The {label} bytes do not match the verified {source['id']} source hash")
    with Image.open(io.BytesIO(original)) as opened:
        image = ImageOps.exif_transpose(opened)
        image.load()
        original_mode = image.mode
        if max(image.size) > MAX_SIDE:
            ratio = MAX_SIDE / max(image.size)
            size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
            image = image.resize(size, Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")

        prepared = EVIDENCE / "prepared" / f"{source['id']}.png"
        prepared.parent.mkdir(parents=True, exist_ok=True)
        image.save(prepared, format="PNG", optimize=False)

    info = {
        "originalInputSha256": sha256(original),
        "sourceFile": str(source_path.relative_to(ROOT)).replace("\\", "/"),
        "preparedInputSha256": sha256(prepared.read_bytes()),
        "originalMode": original_mode,
        "preparedMode": Image.open(prepared).mode,
        "width": image.width,
        "height": image.height,
        "maxSide": MAX_SIDE,
    }
    return prepared, info


def normalize_media_url(url: Any, job_id: str, sample_id: str) -> Any:
    if not isinstance(url, str) or not url.startswith("/media/"):
        return url
    prefix = f"/media/{job_id}/"
    if not url.startswith(prefix):
        raise RuntimeError(f"Unexpected media job prefix: {url}")
    return url.replace(prefix, f"/samples/{sample_id}/", 1)


def all_urls(value: Any):
    if isinstance(value, dict):
        for item in value.values():
            yield from all_urls(item)
    elif isinstance(value, list):
        for item in value:
            yield from all_urls(item)
    elif isinstance(value, str) and value.startswith("/media/"):
        yield value


def rewrite_media(value: Any, job_id: str, sample_id: str) -> Any:
    if isinstance(value, dict):
        return {key: rewrite_media(item, job_id, sample_id) for key, item in value.items()}
    if isinstance(value, list):
        return [rewrite_media(item, job_id, sample_id) for item in value]
    return normalize_media_url(value, job_id, sample_id)


def allowed_relative_path(url: str, job_id: str) -> Path:
    parsed = urllib.parse.urlparse(url)
    prefix = f"/media/{job_id}/"
    if not parsed.path.startswith(prefix):
        raise RuntimeError(f"Not a URL for this job: {url}")
    relative = Path(urllib.parse.unquote(parsed.path[len(prefix):]))
    if relative.is_absolute() or ".." in relative.parts:
        raise RuntimeError(f"Unsafe media URL path: {url}")
    if len(relative.parts) == 1 and relative.as_posix() in ALLOWED_ASSETS:
        return relative
    if (
        len(relative.parts) == 4
        and relative.parts[0] == "styles"
        and relative.parts[2] == ATMOSPHERE_VERSION
    ):
        style = relative.parts[1]
        if style in STYLES and relative.name in ALLOWED_STYLE_ASSETS:
            return relative
    raise RuntimeError(f"Media resource is outside the publish allow-list: {url}")


def copy_media(base: str, job_id: str, sample_id: str, urls: set[str], stage: Path) -> dict[str, str]:
    copied: dict[str, str] = {}
    for url in sorted(urls):
        relative = allowed_relative_path(url, job_id)
        destination = stage / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(base.rstrip("/") + url, timeout=90) as response:
            data = response.read()
        if relative.name == "subject-depth-f32.bin" and len(data) % 4:
            raise RuntimeError("subject-depth-f32.bin byte length is not float32 aligned")
        destination.write_bytes(data)
        copied[relative.as_posix()] = sha256(data)
    return copied


def make_thumbnail(stage: Path, result: dict[str, Any], default_style: str, sample_id: str) -> None:
    composite_url = result["styles"][default_style]["compositeUrl"]
    relative = urllib.parse.urlparse(composite_url).path.removeprefix(f"/samples/{sample_id}/")
    source = stage / relative
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((420, 420), Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        image.save(stage / "thumbnail.webp", format="WEBP", lossless=True, method=6)


def generate_one(base: str, sample_id: str, source: dict[str, Any], replace: bool) -> dict[str, Any]:
    if source.get("input"):
        original_path = Path(source["input"])
        if not original_path.is_absolute():
            original_path = ROOT / original_path
    else:
        raise RuntimeError(f"No source input configured for {sample_id}")

    source["id"] = sample_id
    prepared, input_info = prepare_input(source, original_path)
    evidence: dict[str, Any] = {
        "sampleId": sample_id,
        "source": source["source"],
        "input": {**input_info, "preparedFile": str(prepared.relative_to(ROOT)).replace("\\", "/")},
        "startedAtUtc": datetime.now(timezone.utc).isoformat(),
        "apiBase": base,
        "upload": {},
        "depth": {},
        "styles": {},
    }
    evidence_path = EVIDENCE / "responses" / f"{sample_id}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"

    def checkpoint() -> None:
        write_json(evidence_path, evidence)

    checkpoint()

    upload, elapsed, status = request_json(base, "/api/jobs", file_path=prepared)
    evidence["upload"] = {"httpStatus": status, "requestSeconds": round(elapsed, 3), "response": upload}
    checkpoint()
    job_id = upload.get("id")
    if not isinstance(job_id, str) or not job_id:
        raise RuntimeError(f"Upload did not return an id: {upload}")
    evidence["jobId"] = job_id
    result = poll_json(base, f"/api/jobs/{urllib.parse.quote(job_id, safe='')}", evidence, "uploadJob")
    checkpoint()

    posted, elapsed, status = request_json(base, "/api/depth", {"jobId": job_id})
    evidence["depthPost"] = {"httpStatus": status, "requestSeconds": round(elapsed, 3), "response": posted}
    depth = poll_json(base, f"/api/depth/{urllib.parse.quote(job_id, safe='')}", evidence, "depthJob")
    checkpoint()

    styles: dict[str, Any] = {}
    for style in STYLES:
        posted, elapsed, status = request_json(base, "/api/restyle", {"jobId": job_id, "style": style})
        step = {"post": {"httpStatus": status, "requestSeconds": round(elapsed, 3), "response": posted}}
        styles[style] = poll_json(base, f"/api/restyle/{urllib.parse.quote(job_id, safe='')}/{style}", step, "poll")
        evidence["styles"][style] = step
        if styles[style].get("atmosphereVersion") != ATMOSPHERE_VERSION:
            raise RuntimeError(f"{sample_id}/{style} has unexpected atmosphereVersion")
        checkpoint()

    result["id"] = f"sample:{sample_id}"
    depth["jobId"] = f"sample:{sample_id}"
    for styled in styles.values():
        styled["jobId"] = f"sample:{sample_id}"

    api_result = {"result": result, "depth": depth, "styles": styles}
    urls = set(all_urls(api_result))
    if not urls:
        raise RuntimeError(f"No media URLs were returned for {sample_id}")

    source_dir = PUBLIC / sample_id
    if source_dir.exists() and not replace:
        raise FileExistsError(f"{source_dir} already exists; pass --replace to regenerate it")
    stage = PUBLIC / f".staging-{sample_id}"
    if stage.exists():
        shutil.rmtree(require_managed_child(stage, PUBLIC, {f".staging-{sample_id}"}))
    stage.mkdir(parents=True, exist_ok=True)

    files = copy_media(base, job_id, sample_id, urls, stage)
    rewritten = rewrite_media(api_result, job_id, sample_id)
    record = {
        "id": sample_id,
        "title": source["title"],
        "category": source["category"],
        "thumbnailUrl": f"/samples/{sample_id}/thumbnail.webp",
        "defaultStyle": source["defaultStyle"],
        "source": source["source"],
        **rewritten,
    }
    make_thumbnail(stage, record, source["defaultStyle"], sample_id)
    files["thumbnail.webp"] = sha256((stage / "thumbnail.webp").read_bytes())

    evidence["finishedAtUtc"] = datetime.now(timezone.utc).isoformat()
    evidence["publishedFiles"] = files
    evidence["publishedBytes"] = sum((stage / name).stat().st_size for name in files)
    write_json(evidence_path, evidence)

    if source_dir.exists():
        shutil.rmtree(require_managed_child(source_dir, PUBLIC, set(PUBLICATION_IDS)))
    source_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(stage), str(source_dir))

    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default="http://127.0.0.1:5190")
    parser.add_argument("--include", default=",".join(PUBLICATION_IDS),
                        help="comma-separated architecture IDs: tower,taipei,flatiron,qutub")
    parser.add_argument("--replace", action="store_true",
                        help="replace the corresponding generated public sample directories")
    parser.add_argument("--prune-legacy", action="store_true",
                        help="keep only verified architecture records already present in the manifest; makes no API requests")
    args = parser.parse_args()

    selected = list(dict.fromkeys(part.strip() for part in args.include.split(",") if part.strip()))
    existing_manifest = PUBLIC / "manifest.json"
    if args.prune_legacy:
        if not existing_manifest.exists():
            parser.error(f"cannot read {existing_manifest}")
        try:
            prior = json.loads(existing_manifest.read_text(encoding="utf-8-sig"))
            samples = [
                record for record in prior.get("samples", [])
                if record.get("id") in PUBLICATION_IDS and (PUBLIC / record["id"]).is_dir()
            ]
        except (json.JSONDecodeError, OSError, AttributeError, TypeError):
            parser.error(f"cannot read {existing_manifest}")
        present = {record["id"] for record in samples}
        missing = set(PUBLICATION_IDS) - present
        if missing:
            parser.error(f"cannot finalize manifest; missing generated samples: {', '.join(sorted(missing))}")
        samples.sort(key=lambda record: PUBLICATION_IDS.index(record["id"]))
        write_json(existing_manifest, {"version": 1, "samples": samples})
        print(json.dumps({"manifest": "architecture-only", "samples": [record["id"] for record in samples]}), flush=True)
        return 0

    unknown = set(selected) - set(SAMPLE_SOURCES)
    if unknown:
        parser.error(f"unknown sample ids: {', '.join(sorted(unknown))}")
    if not args.replace:
        existing = [sample_id for sample_id in selected if (PUBLIC / sample_id).exists()]
        if existing:
            parser.error(f"sample directories already exist: {', '.join(existing)}; pass --replace to regenerate them")

    samples: list[dict[str, Any]] = []
    if existing_manifest.exists():
        try:
            prior = json.loads(existing_manifest.read_text(encoding="utf-8-sig"))
            samples = [
                record for record in prior.get("samples", [])
                if record.get("id") in PUBLICATION_IDS and record.get("id") not in selected
            ]
        except (json.JSONDecodeError, OSError):
            parser.error(f"cannot read {existing_manifest}")

    for sample_id in selected:
        source = dict(SAMPLE_SOURCES[sample_id])
        record = generate_one(args.api_base, sample_id, source, args.replace)
        samples.append(record)
        samples.sort(key=lambda item: PUBLICATION_IDS.index(item["id"]))
        write_json(existing_manifest, {"version": 1, "samples": samples})
        print(json.dumps({"sample": sample_id, "status": "published"}), flush=True)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"sample preparation failed: {error}", file=sys.stderr)
        raise
