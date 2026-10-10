# IntoFrame

Make your photos come alive. IntoFrame turns a single image into a cinematic break-the-frame composition. This repository currently contains the **stage 1 static MVP**. The animated depth experience is planned in [ARCHITECTURE.md](ARCHITECTURE.md) and is not represented as implemented.

## What works now

- Upload JPG, PNG or WebP, up to 20 MB; the backend rejects unsupported or broken images.
- Run the official BiRefNet model locally on an NVIDIA GPU to obtain an alpha mask.
- Normalize EXIF orientation and resize source and mask into the same pixel coordinates.
- Render the original photo only inside the cinema aperture and its cut-out subject above the black bars.
- Adjust framing zoom, inspect the generated mask, retry with another photo.
- Report model and image failures without showing a fabricated result.

## Requirements

- Windows with Python 3.11, Node.js 20+, and an NVIDIA GPU with about 8 GB VRAM.
- Internet on the first run to download the BiRefNet weights from Hugging Face.
- A modern desktop browser. All AI inference runs after upload, never per animation frame.

## Run locally

From `D:\hks` in PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install 'torch==2.11.0+cu128' 'torchvision==0.26.0+cu128' --index-url https://download.pytorch.org/whl/cu128
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
& 'D:\nodejs\npm.cmd' install
```

Use the `npm.cmd` on your own PATH if Node is installed elsewhere. Open two terminals:

```powershell
cd D:\hks\backend
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

```powershell
cd D:\hks
& 'D:\nodejs\npm.cmd' run dev
```

Open `http://127.0.0.1:5187`. The first upload can take longer because the model is downloaded and loaded. Source images and results stay in `backend/data/` on this machine and are gitignored. The job queue and progress states are in memory; restarting the API clears job records.

## Model and source credits

- [BiRefNet](https://github.com/ZhengPeng7/BiRefNet), official weights [`ZhengPeng7/BiRefNet`](https://huggingface.co/ZhengPeng7/BiRefNet), MIT per the code repository and model card. The model's remote Python implementation is loaded via `trust_remote_code=True` at pinned revision `e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4`.
- Planned stage 2: [Depth Anything V2 Small](https://github.com/DepthAnything/Depth-Anything-V2), Apache 2.0 for the Small checkpoint. The larger checkpoints have different terms and are not selected here.
- UI: React, Vite, and Lucide icons. Backend: FastAPI, Pillow, and PyTorch.

Check the terms of any additional inpainting model before integrating it. If entering Banana Hacks, cite these dependencies and the AI development tools in the submission, and put eligible work in a public repository with timestamps inside the hacking window as required by the [official rules](https://www.bananahacks.tech/code-of-conduct).

## Stage 1 verification

With both local servers running:

```powershell
.\.venv\Scripts\python.exe scripts\smoke.py
& 'D:\nodejs\node.exe' scripts\browser-smoke.mjs
& 'D:\nodejs\npm.cmd' run build
```

The API smoke script uses scikit-image's `astronaut` (person), `chelsea` (cat), and `coffee` (object) sample images. It checks each produced source, mask, and transparent subject has identical dimensions. The browser script uploads all three again, checks loaded assets, zoom and mask controls, and a 390 px viewport; it saves local screenshots under the gitignored `screenshots/` directory. On this PC, the first model download and person job took about 32 seconds; subsequent warm jobs took about 1 second each, and loading the cached model in a fresh server process took about 12 seconds for the first job. These are local observations, not performance guarantees. The GPU had about 5.25 GB in use after model load, versus about 2.12 GB before it; other processes contribute to both readings.

## Current limits

BiRefNet emits one salient-object mask. A distant subject, several overlapping subjects, or a busy scene can produce an unsuitable composition; the API rejects clearly empty or full masks. The stage 1 crop uses a bounded subject-height heuristic and a manual zoom control. It cannot guarantee an attractive break on every image. Subject selection and brush mask editing, background inpainting, depth, hold-to-live, mobile motion, and exports are not implemented yet. No 30 FPS claim is made until the stage 2 browser interaction is measured.
