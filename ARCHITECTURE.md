# IntoFrame architecture and implementation plan

## Stage 0: checked environment and choices

The workspace was empty at project start. The development PC has Node 24, Python 3.14 and 3.11, an RTX 4060 Laptop GPU with 8188 MiB VRAM, and FFmpeg. Python 3.11 is used for the image-service virtual environment. BiRefNet and Depth Anything V2 Small have both passed real local inference on this GPU.

| Concern | Choice | Reason |
| --- | --- | --- |
| Web app | Vite, React, TypeScript | Small client bundle and immediate local reload; no server rendering needed. |
| API | FastAPI | Validated upload, explicit processing states, separate model adapter. |
| Segmentation | Official BiRefNet via PyTorch, FP16, 1024-square input | Detail-friendly salient-object mask; the official repo describes roughly 3.45 GB GPU memory on RTX 4090 at this size, which is an estimate, not a measurement on this PC. |
| Image geometry | One canonical EXIF-corrected RGB image, longest edge ≤1600 px; mask resized to its exact width/height | All pixels stay in one coordinate system. No web-layer guessing about EXIF or image fit. |
| Static renderer | Two aligned image layers and stationary letterbox bars | The background cannot paint over the bars; the transparent foreground can. The same transform is applied to both layers, preventing duplicate silhouettes while stationary. |
| Stage 2 renderer | Three.js depth mesh for the filled scene; DOM foreground cutout above DOM bars | Perspective camera motion provides depth-dependent pixel travel while the existing break-the-frame stacking remains reliable. |

## Data contract

`POST /api/jobs` accepts multipart `file` and returns a job ID. `GET /api/jobs/{id}` returns `processing`, `complete`, or `failed` and the current stage. A completed result gives `sourceUrl`, `maskUrl`, `subjectUrl`, `width`, `height`, `subjectBounds`, and `composition` (`scale`, `focusX`, `focusY`). The image and mask are at the same resolution; bounds are source pixel coordinates. Files are under `backend/data/<job-id>/`.

`POST /api/depth` accepts `{"jobId":"..."}` only after segmentation completes. `GET /api/depth/{id}` reports depth processing status and then returns native `depth.png`, padded `render-depth.png`, and padded `background.webp` with source and render dimensions, padding, and representative foreground depth. PNG grayscale 0 means farther, 255 means nearer. Percentile normalization and Gaussian smoothing produce a control signal, not metric distance. The original mask and depth retain one native coordinate system; the padded image and depth retain a second shared coordinate system.

## Stage 1 rendering geometry

The source is rendered into a full canvas and clipped to the central 74% aperture. Opaque black bars cover the top and bottom 13% of the canvas. A transparent PNG made with BiRefNet's alpha is rendered after the bars. Source and subject receive the same composition transform, so no second copy is visible within the aperture. Subject head or feet outside the aperture remain visible over the bars. The bounded initial scale is derived from mask bounds; the user can correct framing with a zoom slider. The absence of an inpainted background means camera translation is disabled in stage 1.

## Stage 2: implemented spatial motion

1. Depth Anything V2 Small runs once after segmentation. The server normalizes its relative output using the 2nd and 98th percentiles, smooths it, and writes an 8-bit depth PNG. Inference is serialized with segmentation to avoid peak GPU overlap.
2. OpenCV Telea fills the masked subject region and 6% reflected overscan provides edge pixels. This is a conservative local approximation; large unseen regions cannot be reconstructed from the photo.
3. A 48–96 subdivision `PlaneGeometry` samples the padded depth map and displaces vertices by `z = 0.62 × depth`. With camera distance `C = 3.5`, each original vertex position is multiplied by `(C − z)/C`. This compensation puts every vertex back at its original pixel at the rest pose. A perspective camera then moves laterally; screen displacement at a fixed depth is `−f_pixels × cameraX/(C − z)`.
4. The representative foreground plane sits slightly ahead of the depth mesh. The transparent DOM subject receives the same projection formula from the camera position and foreground plane depth. This is a 2.5D layer, so parts of one subject at different depths do not self-parallax, but the screen motion is tied to the camera projection rather than an arbitrary CSS speed. DOM bars cover only the mesh; DOM subject remains above them.
5. Camera sway is clamped by the 6% overscan width and the nearest displaced depth, then eased with a damped spring. Edge-touching masks further reduce camera travel. The Three canvas has transparent clear pixels over the *same filled background image*, so an exposed mesh edge cannot become a black hole. Pointer capture handles mouse/touch release and cancellation; blur also settles the scene. Device pixel ratio is capped at 1.5. Reduced-motion preference suppresses the animation. AI is never called per frame.

## Main risks and gates

- **Actual BiRefNet runtime:** verified on this RTX 4060 with PyTorch 2.11 CUDA 12.8, including a fresh model download, cached model reload, and three image categories. Time and VRAM observations are recorded in README; test again on another PC.
- **Segmentation quality:** test a person with hair, a pet with fur, and an object or scene. Mask holes and ambiguous subjects require selection or brush edits; stage 1 does not yet provide those edits.
- **Disocclusion:** a depth mesh cannot invent surfaces hidden behind the subject. Inpainting or a tight camera bound is required before stage 2 motion ships.
- **Single-photo depth:** relative depth can be noisy around edges and reflective materials. Use smoothing and conservative camera travel, and compare result visually rather than claiming physical reconstruction.
- **Model weights and memory:** both models ran locally in the same process with serialized inference. A spot GPU reading after both loaded was 5044 MiB used, including other processes. Keep inference on uploads only; test again under competition-day GPU load.

## Delivery sequence

1. Stage 1: verify model on this PC, inspect masks on at least three categories, improve composition and mask correction, capture first screenshots.
2. Stage 2: depth artifact, perspective grid, hold interaction, occlusion and travel limit, browser FPS measurement. Free drag exploration remains future work.
3. Stage 3: licensed inpainting model, edge cleanup, dynamic bars, mobile layout and optional sensor motion.
4. Stage 4: three-category QA, README, screenshots, and an under-three-minute demo script/video.
