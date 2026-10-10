# IntoFrame

Turn ordinary photos into cinematic AI compositions. IntoFrame isolates the original subject, generates a new sky atmosphere with a local diffusion model, and places the subject over film bars. The optional hold animation uses one-shot relative depth and browser-side Three.js rendering.

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
- Choose Dreamy Pink, Golden Hour, or Cinematic Night. A local Stable Diffusion inpainting checkpoint generates a new sky field. The full-resolution original subject is restored using the BiRefNet alpha mask; no paid image API is called.
- Compare Before/After, watch generation status, and download a full-resolution PNG with the visible film bars and pop-out subject.

## Requirements

- Windows with Python 3.11, Node.js 20+, and an NVIDIA GPU with about 8 GB VRAM.
- Internet on the first run to download BiRefNet, Depth Anything V2 Small, and Stable Diffusion v1.5 Inpainting weights from Hugging Face. Allow several GB of model cache and free RAM/disk space. Diffusion generation is serialized with other AI work to fit the 8 GB GPU.
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

Open `http://127.0.0.1:5187`. The static preview appears as soon as segmentation completes; depth continues in the background. Choose a style and press **Generate background**. The first generation downloads the diffusion model; later generations are faster. Source images and results stay in `backend/data/` on this machine and are gitignored. Job records are in memory; restarting the API clears them. No API key or paid service is configured or required. The model weights are downloaded from Hugging Face, so the first run needs network access.

For a single-origin local demo after `npm run build`, run `.\.venv\Scripts\python.exe scripts\serve-subject-experiment.py` from `D:\hks` and open `http://127.0.0.1:5190/`. This helper also keeps `/experiment.html` accessible without changing the production preview.

## AI background generation and export

After segmentation, `POST /api/restyle` accepts `{"jobId":"<id>","style":"dreamy-pink"}`. Supported styles are `dreamy-pink`, `golden-hour`, and `cinematic-night`. Poll `GET /api/restyle/{id}/{style}` for `processing`, `complete`, or `failed`. A completed result includes native-size `backgroundUrl`, `compositeUrl`, and a reflected-overscan `renderBackgroundUrl` for the existing depth renderer. The endpoint reports errors rather than returning a substitute image.

The local [Stable Diffusion v1.5 Inpainting checkpoint](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting) runs in FP16 at about 640 px on its longest side with CPU offload and 22 denoising steps. In this MVP it synthesizes a coherent **whole-sky underlay**; the subject mask protects original pixels during the final full-resolution composite. A small deterministic crop selects the generated sky region. Golden Hour receives a warm grade and Cinematic Night a cool grade. This is genuine diffusion generation followed by conventional crop/color processing. It is **not** context-aware replacement of every original background object: photos whose original scene is not sky may look like a cutout. It does not relight the preserved subject. The optional depth mesh continues to use the original relative depth map, so a radically different generated background may have imperfect motion geometry.

The browser PNG exporter uses the current zoom and composition offsets, clips the generated background to the middle 74%, draws the 13% top and bottom bars, then draws the original transparent subject over them. It exports a still image at the processed source resolution; camera animation is an interactive webpage effect and is not encoded in the PNG.

## Depth API and image coordinates

After `GET /api/jobs/{id}` completes, send `POST /api/depth` with JSON `{"jobId":"<id>"}`. Poll `GET /api/depth/{id}` until `status` is `complete` or `failed`. A completed result gives:

- `depthUrl`: native-size 8-bit grayscale PNG, white (255) nearer and black (0) farther. Values are robust percentile-normalized **relative** depth, not metres.
- `renderDepthUrl`: the same signal after subject-hole fill and reflected edge padding; `backgroundUrl`: the matching padded RGB WebP. `renderWidth`, `renderHeight`, and `padding` describe their coordinates.
- `foregroundDepth`: median native depth within the alpha subject, used to choose a bounded foreground projection plane.

Source, mask, subject and native depth share the same EXIF-corrected width and height. Both padded render assets share another exact width and height. These files are generated once per uploaded photo; no AI call runs during animation. Depth errors leave the static preview visible with a clear message.

## Model and source credits

- [BiRefNet](https://github.com/ZhengPeng7/BiRefNet), official weights [`ZhengPeng7/BiRefNet`](https://huggingface.co/ZhengPeng7/BiRefNet), MIT per the code repository and model card. The model's remote Python implementation is loaded via `trust_remote_code=True` at pinned revision `e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4`.
- [Depth Anything V2 Small](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf), Apache 2.0 for the Small checkpoint, loaded at pinned revision `5426e4f0f36572d16453bbda7a8389317b1bef99`. Larger checkpoints have different terms and are not selected here.
- [Stable Diffusion v1.5 Inpainting](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting), CreativeML OpenRAIL-M, loaded at pinned revision `8a4288a76071f7280aedbdb3253bdb9e9d5d84bb`. Review its license and use restrictions before publication; model output quality varies by image.
- UI: React and Three.js (MIT), Vite (MIT), Lucide icons (ISC). Backend: FastAPI (MIT), Diffusers (Apache 2.0), Pillow (HPND), OpenCV (Apache 2.0), and PyTorch (BSD-style). Check each package's bundled license when redistributing.

For Banana Hacks 2026, cite the models, libraries, and AI development tools in the submission. The Git history is preserved with its real timestamps. A public GitHub remote has not yet been configured; do not claim a public submission until that separate step is approved and completed.

After reviewing the tracked files and explicitly approving the first public push, create an empty public repository named `IntoFrame` on GitHub (without an initial README or license), then run the following with your own GitHub username. These commands have not been executed:

```powershell
cd D:\hks
git status
git remote add origin https://github.com/YOUR_USERNAME/IntoFrame.git
git push -u origin main
```

Failed background jobs can be submitted again with the same source and style. Processing requests share the existing task; completed requests reuse the saved result.

## Verification

With both local servers running:

```powershell
.\.venv\Scripts\python.exe scripts\smoke.py
& 'D:\nodejs\node.exe' scripts\browser-smoke.mjs
.\.venv\Scripts\python.exe scripts\depth-smoke.py
& 'D:\nodejs\node.exe' scripts\spatial-browser-smoke.mjs
& 'D:\nodejs\node.exe' scripts\restyle-browser-smoke.mjs
& 'D:\nodejs\npm.cmd' run build
```

The scripts use scikit-image's `astronaut` (person), `chelsea` (cat), and `coffee` (object) sample images. Run the data smoke script first to create the sample source files. The restyle browser test defaults to the Vite URL and accepts `INTOFRAME_URL=http://127.0.0.1:5190` for the single-origin build. Set `INTOFRAME_TEST_PHOTO` to an absolute JPG/PNG/WebP path to test another image. The restyle script captures Before/After screenshots and an exported PNG under gitignored `screenshots/` and checks hold movement. The depth smoke checks asset dimensions and non-flat depth values. The spatial browser test checks hold motion, release settling, layer order, mobile touch, reduced-motion preference and frame timing. Earlier local measurements of the existing stage 2 preview are about 240 animation callbacks per second with a 4.2 ms 95th-percentile frame interval over two seconds in headless Chrome; this does not guarantee performance on other displays.

Example from a local Big Ben photo: the blue sky became pink clouds while the original clock faces and tower remained intact; the exported PNG was 1426 × 1600 and retained the black bars and a tower tip above the top bar. The same generator also completed a cat photo, though its mask touched the photo boundaries, so most of the frame remained the original cat. Local example images live in ignored `screenshots/` and are not checked into Git because they derive from user/test photos.

## Current limits

BiRefNet emits one salient-object mask. A distant subject, several overlapping subjects, or a busy scene can produce an unsuitable composition; the API rejects clearly empty or full masks. The crop uses a bounded subject-height heuristic and a manual zoom control. It cannot guarantee an attractive break on every image. The local SD1.5 model may invent an unwanted horizon or produce repetitive clouds; the sky crop and cool night grade are bounded fallbacks. Bright day-lit subjects against a night sky can look composited because the original subject RGB is deliberately preserved. Fine mask edges may retain a trace of the old sky color. OpenCV Telea still fills the hidden subject in the **original** depth background; the generated full-sky underlay already exists behind the subject. Depth is relative and may be wrong on reflective objects. Camera travel is clamped to reflected overscan. This is a 2.5D illusion, not a reconstructed 3D scene. Subject selection, brush mask editing, free drag exploration, mobile gyroscope and video export remain future work. Browser timing is measured in local headless Chrome and should be checked again on the presentation device.
