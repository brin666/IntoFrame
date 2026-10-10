# IntoFrame

Make your photos come alive. IntoFrame turns a single image into a cinematic break-the-frame composition with a bounded, depth-driven hold animation. This repository contains the **stage 2 local MVP**.

An isolated [Subject Depth Mesh experiment](SUBJECT_DEPTH_EXPERIMENT.md) is available at
`/experiment.html`; it does not replace the production preview.

## What works now

- Upload JPG, PNG or WebP, up to 20 MB; the backend rejects unsupported or broken images.
- Run the official BiRefNet model locally on an NVIDIA GPU to obtain an alpha mask.
- Normalize EXIF orientation and resize source and mask into the same pixel coordinates.
- Render the original photo only inside the cinema aperture and its cut-out subject above the black bars.
- Adjust framing zoom, inspect the generated mask, retry with another photo.
- Report model and image failures without showing a fabricated result.
- After the static preview appears, estimate relative depth once with Depth Anything V2 Small, fill the primary subject's hidden background conservatively, and render a padded depth mesh in Three.js.
- Hold the photo with a mouse or finger to wake a small camera sway; release to settle. The transparent subject remains above the film bars. Reduced-motion preference leaves the photo still.

## Requirements

- Windows with Python 3.11, Node.js 20+, and an NVIDIA GPU with about 8 GB VRAM.
- Internet on the first run to download the BiRefNet and Depth Anything V2 Small weights from Hugging Face.
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

Open `http://127.0.0.1:5187`. The static preview appears as soon as segmentation completes; depth continues in the background and enables the hold interaction when ready. First use can take longer while models download. Source images and results stay in `backend/data/` on this machine and are gitignored. Job records are in memory; restarting the API clears them.

## Depth API and image coordinates

After `GET /api/jobs/{id}` completes, send `POST /api/depth` with JSON `{"jobId":"<id>"}`. Poll `GET /api/depth/{id}` until `status` is `complete` or `failed`. A completed result gives:

- `depthUrl`: native-size 8-bit grayscale PNG, white (255) nearer and black (0) farther. Values are robust percentile-normalized **relative** depth, not metres.
- `renderDepthUrl`: the same signal after subject-hole fill and reflected edge padding; `backgroundUrl`: the matching padded RGB WebP. `renderWidth`, `renderHeight`, and `padding` describe their coordinates.
- `foregroundDepth`: median native depth within the alpha subject, used to choose a bounded foreground projection plane.

Source, mask, subject and native depth share the same EXIF-corrected width and height. Both padded render assets share another exact width and height. These files are generated once per uploaded photo; no AI call runs during animation. Depth errors leave the static preview visible with a clear message.

## Model and source credits

- [BiRefNet](https://github.com/ZhengPeng7/BiRefNet), official weights [`ZhengPeng7/BiRefNet`](https://huggingface.co/ZhengPeng7/BiRefNet), MIT per the code repository and model card. The model's remote Python implementation is loaded via `trust_remote_code=True` at pinned revision `e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4`.
- [Depth Anything V2 Small](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf), Apache 2.0 for the Small checkpoint, loaded at pinned revision `5426e4f0f36572d16453bbda7a8389317b1bef99`. Larger checkpoints have different terms and are not selected here.
- UI: React, Vite, Three.js, and Lucide icons. Backend: FastAPI, Pillow, OpenCV, and PyTorch.

Check the terms of any additional inpainting model before integrating it. If entering Banana Hacks, cite these dependencies and the AI development tools in the submission, and put eligible work in a public repository with timestamps inside the hacking window as required by the [official rules](https://www.bananahacks.tech/code-of-conduct).

## Verification

With both local servers running:

```powershell
.\.venv\Scripts\python.exe scripts\smoke.py
& 'D:\nodejs\node.exe' scripts\browser-smoke.mjs
.\.venv\Scripts\python.exe scripts\depth-smoke.py
& 'D:\nodejs\node.exe' scripts\spatial-browser-smoke.mjs
& 'D:\nodejs\npm.cmd' run build
```

The scripts use scikit-image's `astronaut` (person), `chelsea` (cat), and `coffee` (object) sample images. The depth API smoke test checks all asset dimensions and non-flat depth values. The spatial browser test checks hold motion, release settling, subject/bar layer order, mobile touch, reduced-motion preference and frame timing; screenshots go under gitignored `screenshots/`. On this PC, segmentation took 11.3 seconds for the first sample and about 1.1 seconds warm; the first depth run including model download/load took 86.4 seconds and subsequent samples took about 1.1 seconds. Local headless Chrome measured about 240 animation callbacks per second with a 4.2 ms 95th-percentile frame interval during a 2-second hold. This exceeds the 30 FPS target in that test, but it does not establish performance on every display or browser. After both models loaded, `nvidia-smi` reported 5044 MiB used across the GPU, which includes other processes.

## Current limits

BiRefNet emits one salient-object mask. A distant subject, several overlapping subjects, or a busy scene can produce an unsuitable composition; the API rejects clearly empty or full masks. The crop uses a bounded subject-height heuristic and a manual zoom control. It cannot guarantee an attractive break on every image. OpenCV Telea fills the hidden subject region only to support small camera travel; a large mask can leave visibly invented texture if the foreground moves too far. Depth is relative and may be wrong on reflective objects. Camera travel is clamped to reflected overscan. This is a 2.5D illusion, not a reconstructed 3D scene. Subject selection, brush mask editing, free drag exploration, mobile gyroscope and exports remain future work. Browser timing is measured in local headless Chrome and should be checked again on the presentation device.
