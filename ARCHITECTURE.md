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
| AI style MVP | Local SD1.5 Inpainting sky generation, original subject mask composite | Serialized, no paid API calls, preserves subject RGB and keeps the existing pop-out and depth renderer. |

## Data contract

`POST /api/jobs` accepts multipart `file` and returns a job ID. `GET /api/jobs/{id}` returns `processing`, `complete`, or `failed` and the current stage. A completed result gives `sourceUrl`, `maskUrl`, `subjectUrl`, `width`, `height`, `subjectBounds`, and `composition` (`scale`, `focusX`, `focusY`). The image and mask are at the same resolution; bounds are source pixel coordinates. Files are under `backend/data/<job-id>/`.

`POST /api/depth` accepts `{"jobId":"..."}` only after segmentation completes. `GET /api/depth/{id}` reports depth processing status and then returns native `depth.png`, padded `render-depth.png`, and padded `background.webp` with source and render dimensions, padding, and representative foreground depth. PNG grayscale 0 means farther, 255 means nearer. Percentile normalization and Gaussian smoothing produce a control signal, not metric distance. The original mask and depth retain one native coordinate system; the padded image and depth retain a second shared coordinate system.

`POST /api/restyle` accepts `{"jobId":"...","style":"dreamy-pink"}` after segmentation. Styles are `dreamy-pink`, `golden-hour`, and `cinematic-night`. `GET /api/restyle/{id}/{style}` reports queued/loading/generating/compositing status, then URLs for lossless native generated `background.webp`, source-resolution `composite.png`, recovered-edge `subject.png`, and lossless padded `render-background.webp`. Styled subject stays above the bars; original view and experiment keep the original foreground. Source RGB is lossless, so all layers use one canonical set of pixels. Failed jobs can retry without duplicate active tasks.

## AI style pipeline

During upload, BiRefNet supplies subject alpha and a pinned CPU SegFormer B0 supplies independent sky probabilities/class labels. The result includes `subjectStats` (actual occupancy and side-contact row fractions) and `sky` (eligibility, reason, status, bounds, mask URL, confidence coverage and model pin). Sky requires >=1% area and >=90% high-confidence coverage of candidate sky. Reliable boundaries grow at most 12 native pixels inside semantic sky; the final feather is 2px inward. Alpha>=2 is excluded. No-sky, broad ambiguity and unavailable inference return still preview with Generate disabled; POST independently rejects422 before scheduling. The detector is licensed for noncommercial research/evaluation.

SD1.5 synthesizes an independent sky field on neutral RGB, with existing640px/22step/crop/grade settings. `sky_compositing.py` replaces only confirmed editable sky. Visible RGB outside sky and subject remains byte-identical. Telea approximates occluded subject pixels, and nearest nearby sky coverage is extended only underneath the subject. Translucent edges adjoining unchanged scene retain original underlay RGB. Edge recovery is limited to subject boundaries adjoining changing sky; alpha remains identical.

After the unchanged suitability gate, `sky_refinement.py` resolves local coarse-label sky omissions using native RGB, fine subject alpha, semantic class constraints and four-neighbor connectivity to existing sky. Reach is four model cells capped at64px; high-confidence other classes and disconnected holes remain protected. It does not use inverse alpha as the scene's editable mask. Actual logits/coarse masks are retained for diagnosis. The captured Big Ben false-negative sky patch had alpha0, editable0 and preserved-scene alpha255; refinement changes sky weight, not subject alpha or camera. Large Eiffel interior openings remain a documented visual failure. See [repair evidence](docs/SKY_EDGE_REPAIR.md).

Each style saves lossless native `background.webp`, `subject.png`, `composite.png`, padded `render-background.webp`, `render-sky.webp` and RGBA `render-scene.png`. The flattened native/padded backgrounds are composites of these same layer pixels; no separate dynamic color generation is used. `backgroundGeometry: "sky-layers"` and the two URLs are attached to the current visibleDepth identity. Native background is used by PNG; padded flattening is the still fallback. Three.js raster/linear blending may differ at a narrow antialiased boundary from browser/PIL sampling; screenshot pixel identity is not claimed.

After renders sky at virtualz=-0.8 and the retained scene at the representative subject depth z=.78–.98. Both planes receive `(C-z)/C` XY compensation to reproduce the source center view. DOM subject shares the same perspective projection above stationary13% bars. Retained scene is consciously flat at subject depth to keep feet/support aligned; it does not reconstruct other buildings/objects. Before retains the original depth mesh and remains still. Original depth is never imposed on edited sky.

`parallax.ts` derives camera travel from a CSS-pixel separation target: `zoom*focalPixels*(1/(C-zSubject)-1/(C-zSky))`. Viewport, touch/desktop target, occupancy and bounded original subject depth determine requested travel. Overscan and source-side crop contact cap each direction. A single source cut produces one-sided smooth sway; no safe room or weak motion produces a notice. Resize/crop recalculate caps; final camera position is clamped to prevent spring overshoot. PNG uses the current shared center composition, independent of this camera state.

Hold is enabled only for a completed generated After, with readiness tied to the current `DepthResult` scene identity. A previous texture's readiness cannot activate a newly loading result. Mask, Before, generation and reduced-motion states disable hold. Primary pointer capture, boundary checks, cancel/lost capture, blur and page hiding release the interaction. Resource switches clear the held pointer. Scene asset errors are separate from depth inference failures; a new scene attempt can recover from a failed texture without rerunning AI.

## Stage 1 rendering geometry

The source is rendered into a full canvas and clipped to the central 74% aperture. Opaque black bars cover the top and bottom 13% of the canvas. A transparent PNG made with BiRefNet's alpha is rendered after the bars. Source and subject receive the same composition transform, so no second copy is visible within the aperture. Subject head or feet outside the aperture remain visible over the bars. The bounded initial scale is derived from mask bounds; the user can correct framing with a zoom slider. The absence of an inpainted background means camera translation is disabled in stage 1.

## Stage 2: implemented spatial motion

1. Depth Anything V2 Small runs once after segmentation. The server normalizes its relative output using the 2nd and 98th percentiles, smooths it, and writes an 8-bit depth PNG. Inference is serialized with segmentation to avoid peak GPU overlap.
2. OpenCV Telea fills the masked subject region and 6% reflected overscan provides edge pixels. This is a conservative local approximation; large unseen regions cannot be reconstructed from the photo.
3. A 48–96 subdivision `PlaneGeometry` samples the padded depth map and displaces vertices by `z = 0.62 × depth`. With camera distance `C = 3.5`, each original vertex position is multiplied by `(C − z)/C`. This compensation puts every vertex back at its original pixel at the rest pose. A perspective camera then moves laterally; screen displacement at a fixed depth is `−f_pixels × cameraX/(C − z)`.
4. The representative foreground plane sits slightly ahead of the depth mesh. The transparent DOM subject receives the same projection formula from the camera position and foreground plane depth. This is a 2.5D layer, so parts of one subject at different depths do not self-parallax, but the screen motion is tied to the camera projection rather than an arbitrary CSS speed. DOM bars cover only the mesh; DOM subject remains above them.
5. Camera sway is clamped by the 6% overscan width and the nearest displaced depth, then eased with a damped spring. Generated After uses the adaptive projection/crop policy described above; original Before remains still. The Three canvas has transparent clear pixels over the *same background image*, so an exposed mesh edge cannot become a black hole. Device pixel ratio is capped at 1.5. Reduced-motion preference suppresses animation. AI is never called per frame. See [current sky/hold regression](docs/SKY_REGRESSION.md) for measured rendered-result acceptance and limits.

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
