"""Capture actual baseline model runs, then reuse their sky pixels after repair."""
from pathlib import Path
import json
import shutil
import time
import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "screenshots" / "edge-repair"
BASE = "http://127.0.0.1:5190"


def request(path, value=None):
    payload = json.dumps(value).encode() if value is not None else None
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE+path, data=payload, headers={"Content-Type":"application/json"} if payload else {}), timeout=30))


def poll(path):
    for _ in range(360):
        result = request(path)
        if result["status"] != "processing":
            return result
        time.sleep(1)
    raise TimeoutError(path)


def main():
    manifest = OUT / "acceptance-frozen.json"
    records = json.loads(manifest.read_text()) if manifest.exists() else {}
    for name in ("eiffel", "dog"):
        if name in records:
            continue
        photo = ROOT / "backend/data/edge-repair-inputs" / (name+".png")
        boundary = "IntoFrameEdgeCapture"
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + photo.read_bytes() + f'\r\n--{boundary}--\r\n'.encode())
        req = urllib.request.Request(BASE+"/api/jobs", data=body, headers={"Content-Type":f"multipart/form-data; boundary={boundary}"})
        job_id = json.load(urllib.request.urlopen(req, timeout=30))["id"]
        job = poll("/api/jobs/"+job_id)
        record = {"job":job,"jobId":job_id,"input":str(photo),"baselineVersion":"d58406a"}
        print(name,"upload",job,flush=True)
        if job["status"] == "complete" and job["result"]["sky"]["eligible"]:
            request("/api/depth", {"jobId":job_id})
            record["depth"] = poll("/api/depth/"+job_id)
            request("/api/restyle", {"jobId":job_id,"style":"cinematic-night"})
            record["style"] = poll("/api/restyle/"+job_id+"/cinematic-night")
            print(name,"style",record["style"]["status"],flush=True)
        folder = ROOT / "backend/data" / job_id
        target = OUT / "acceptance-before" / name
        if folder.exists():
            shutil.copytree(folder,target,dirs_exist_ok=True)
        records[name]=record
        manifest.write_text(json.dumps(records,indent=2),encoding="utf8")


if __name__ == "__main__":
    main()
