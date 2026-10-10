# IntoFrame architecture and implementation plan

## Stage 0: checked environment and choices

The workspace was empty at project start. The development PC has Node 24, Python 3.14 and 3.11, an RTX 4060 Laptop GPU with 8188 MiB VRAM, and FFmpeg. Python 3.11 is chosen for the image-service virtual environment so that older computer-vision dependencies are less likely to be a problem. GPU availability and model inference still need a real local test; hardware alone is not proof that the model runs.

| Concern | Choice | Reason |
| --- | --- | --- |
| Web app | Vite, React, TypeScript | Small client bundle and immediate local reload; no server rendering needed. |
| API | FastAPI | Validated upload, explicit processing states, separate model adapter. |
| Segmentation | Official BiRefNet via PyTorch, FP16, 1024-square input | Detail-friendly salient-object mask; the official repo describes roughly 3.45 GB GPU memory on RTX 4090 at this size, which is an estimate, not a measurement on this PC. |
| Image geometry | One canonical EXIF-corrected RGB image, longest edge ≤1600 px; mask resized to its exact width/height | All pixels stay in one coordinate system. No web-layer guessing about EXIF or image fit. |
| Static renderer | Two aligned image layers and stationary letterbox bars | The background cannot paint over the bars; the transparent foreground can. The same transform is applied to both layers, preventing duplicate silhouettes while stationary. |
| Stage 2 renderer | Three.js with one bounded depth mesh for the filled scene and a foreground cutout layer | Real camera projection is needed for depth-dependent pixel motion; plain CSS translations are insufficient. |

## Data contract

`POST /api/jobs` accepts multipart `file` and returns a job ID. `GET /api/jobs/{id}` returns `processing`, `complete`, or `failed` and the current stage. A completed result gives `sourceUrl`, `maskUrl`, `subjectUrl`, `width`, `height`, `subjectBounds`, and `composition` (`scale`, `focusX`, `focusY`). The image and mask are at the same resolution; bounds are source pixel coordinates. Files are under `backend/data/<job-id>/`.

## Stage 1 rendering geometry

The source is rendered into a full canvas and clipped to the central 74% aperture. Opaque black bars cover the top and bottom 13% of the canvas. A transparent PNG made with BiRefNet's alpha is rendered after the bars. Source and subject receive the same composition transform, so no second copy is visible within the aperture. Subject head or feet outside the aperture remain visible over the bars. The bounded initial scale is derived from mask bounds; the user can correct framing with a zoom slider. The absence of an inpainted background means camera translation is disabled in stage 1.

## Stage 2: real spatial motion

1. Run Depth Anything V2 Small once per upload. Preserve raw relative depth and robustly normalize with percentiles, then clamp to a shallow inverse-depth range. Do not interpret it as measured meters.
2. Triangulate a regular image grid (initially 64 × 64) and assign each vertex a synthetic `Z` from filtered depth. Project the textured mesh with a perspective camera. For lateral camera translation `ΔX`, projected motion follows `Δx ≈ f · ΔX / Z`; nearer image regions move more. Validate this with a depth-step fixture.
3. Inpaint the region hidden by the primary subject before translating the scene. Render the cutout foreground at its own depth with an alpha texture. Use one projection and shared image UVs to keep subject and scene aligned. Composite a second foreground pass outside the central aperture so the subject can still cross the bars, while the background remains clipped to it.
4. Bound travel from the usable image overscan and inpainted margin. For each depth bin, estimate maximum screen shift `f · |ΔX| / Z`; restrict `ΔX` so the shift stays below the valid filled margin. Fall back to smaller travel if confidence or inpainting quality is low. Never expose an empty region just to make movement stronger.
5. On pointer hold, move the virtual camera on a slow sinusoidal path; on release, damp velocity and return to the origin. Allow drag to add a bounded offset. Measure frame times on the target browser and tune mesh density, texture size, and device pixel ratio to the 30 FPS goal.

## Main risks and gates

- **Actual BiRefNet runtime:** verified on this RTX 4060 with PyTorch 2.11 CUDA 12.8, including a fresh model download, cached model reload, and three image categories. Time and VRAM observations are recorded in README; test again on another PC.
- **Segmentation quality:** test a person with hair, a pet with fur, and an object or scene. Mask holes and ambiguous subjects require selection or brush edits; stage 1 does not yet provide those edits.
- **Disocclusion:** a depth mesh cannot invent surfaces hidden behind the subject. Inpainting or a tight camera bound is required before stage 2 motion ships.
- **Single-photo depth:** relative depth can be noisy around edges and reflective materials. Use smoothing and conservative camera travel, and compare result visually rather than claiming physical reconstruction.
- **Model weights and memory:** load sequentially, not concurrently, on the 8 GB GPU; release the segmentation model before loading depth if peak memory requires it. Keep inference on uploads only.

## Delivery sequence

1. Stage 1: verify model on this PC, inspect masks on at least three categories, improve composition and mask correction, capture first screenshots.
2. Stage 2: depth artifact, perspective grid, hold and drag controls, occlusion and travel limit, browser FPS measurement.
3. Stage 3: licensed inpainting model, edge cleanup, dynamic bars, mobile layout and optional sensor motion.
4. Stage 4: three-category QA, README, screenshots, and an under-three-minute demo script/video.
