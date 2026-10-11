# Generated-result hold parallax — 2026-10-11

> Historical checkpoint before Sky Restyling First. Current behavior and acceptance are in [SKY_REGRESSION.md](SKY_REGRESSION.md); indoor astronaut, coffee and cat no longer generate sky.
## Diagnosis before editing

The generated result was already connected to Three.js. `App.tsx` replaces `DepthResult.backgroundUrl` with the selected style's `renderBackgroundUrl`. `SpatialFrameScene` loads that padded generated texture. It does **not** load `render-depth.png` in sky mode. The native generated `backgroundUrl` is used by the still PNG exporter.

The visible preview is layered, not an opaque composite over the canvas:

| Layer | Source and role |
| --- | --- |
| Background, z=1 | Padded generated sky fallback image, then the Three canvas above it; clipped to the middle 74%. |
| Film bars, z=2 | Equal 13% DOM bars, with wake-dependent inner gradients. |
| Subject, z=3 | Styled edge-recovered transparent PNG, projected using the same virtual camera. It remains above the bars. |
| Mask inspection, z=4 | Inspection only; hold is disabled. |
| Before | Original filled background and original cutout; stays still in the main comparison. |

The main weakness was the inherited travel penalty. Any source-mask edge contact multiplied camera travel by **0.45**, including Big Ben's **bottom** contact during horizontal sway. A complete generated sky no longer needs the filled original's hidden-subject protection. Together with the existing conservative overscan bound, this gave only **2.56 CSS px** of maximum subject-to-sky separation for Big Ben and **2.12 px** for the person in a real pre-fix hold capture.

Other confirmed issues: Before and generation were not excluded from hold, a captured pointer kept animating outside the photo, scene readiness was shared across textures, and an image/WebGL failure reused `depthError`, blocking later scene attempts.

## Changes and depth sources

- Full generated skies use the existing overscan camera bound without the source-mask 0.45 penalty. The 0.06 camera ceiling, damped spring, wake scale and projection formulas stay unchanged. The original filled-photo renderer retains its conservative edge penalty.
- Original Depth Anything V2 subject median selects the existing bounded foreground plane (`z=0.78…0.98`). The foreground remains a 2.5D cutout, not a per-vertex subject mesh. The relative normalized depth is **not metres**.
- Generated sky is a far plane at `z=0`, not old scene geometry. It does not inherit room/road/building relief or trigger AI inference during hold. Sky mode also skips its previously unused full-size depth pixel cache.
- Readiness belongs to the exact scene data returned by the renderer after its first frame. Only ready generated After results can capture a primary pointer. Before, generation, mask and reduced motion stay still.
- Release, cancel, lost capture, moving outside, blur and page hiding stop hold. Changing resource or disabling interaction releases the held pointer. Asset rendering errors are separate from depth inference failures; switching Before/After retries a failed texture.
- PNG still draws native background, subject and bars using center composition. It does not read animated DOM transforms or capture the live canvas.

## Actual regression

Two photos were really uploaded, segmented, depth-estimated and generated in Dreamy Pink, each on desktop Chrome and Chrome mobile/touch emulation. No success response or generated image was substituted. HTTP failures were injected separately only to exercise error/retry paths.

| Case | Desktop peak separation | Touch peak separation | Result |
| --- | --- | --- | --- |
| Big Ben, Dreamy Pink | about 5.69 CSS px | about 3.31 CSS px | Visible restrained layer parallax; tower tip stays over top bar. |
| NASA astronaut person, Dreamy Pink | about 4.7 CSS px | about 2.43 CSS px | Person and sky move differently; head stays over top bar. |

Separation is calculated from **live camera position and the two perspective projection depths**, not an optical-flow measurement or proof of reconstructed 3D. Actual held screenshots differ from the rest screenshot, and normal-size rest/hold/settled images were inspected. The complete sky avoids the old subject-hole fringe. No severe duplicate subject, torn sky or black hole was seen in these two samples. Existing mask-edge color traces and the photo's original subject crop remain.

Passed checks:

- Real Generate and selection in Dreamy Pink, Golden Hour and Cinematic Night; transport error followed by real inference retry.
- New generated texture attached to the canvas; subject and bars retain their stacking; bars have equal height.
- Desktop hold/release, pointer cancel, mouse exit and blur; emulated touch hold/end/cancel; zero horizontal overflow.
- Before remains static and returns to interactive After. Pre-generation, generating, mask and reduced-motion views do not animate.
- Style switching cancels hold **while the pointer remains down**. A deliberately failed Night texture disables hold, then recovers after Before/After without new AI inference.
- Static PNG downloads during hold and at rest have identical SHA-256 bytes in all four cases; dimensions are processed source resolution. No UI enters the export.
- No AI POST occurs during hold. Generated sky hold does not request old background depth.
- TypeScript/Vite build; 3 restyle scheduling/retry tests; 4 compositing tests; three-category upload/zoom/mask browser checks.
- Existing `experiment.html`: Flat/Depth Left/Center/Right, debug, stress settings, hold and settle passed with no page errors. Its renderer and assets were not replaced.

Headless Chrome produced roughly 200–240 animation callbacks/s with about 4.3–4.4 ms p95 intervals during the observed runs. These are **browser callback measurements, not actual display FPS**. Mobile testing used 390×844 Chrome touch emulation; a physical phone and its GPU were not tested.

## Reproduce

Build and start the single-origin server as described in [README](../README.md). From the repository root:

```powershell
$env:INTOFRAME_URL='http://127.0.0.1:5190'
# Optional local building photo; omitted means person-only spatial regression.
$env:INTOFRAME_TEST_PHOTO='<your local Big Ben photo>'
node scripts/parallax-browser-smoke.mjs
# The established spatial-browser-smoke.mjs command calls the same test.
node scripts/restyle-browser-smoke.mjs
node scripts/browser-smoke.mjs
node scripts/subject-experiment-browser.mjs
```

The data smoke script must have prepared the licensed person/pet/object files first. Local evidence is under ignored `screenshots/parallax/regression/`: `results.json`, one directory per case/device with `rest.png`, `hold.png`, `settled.png`, and equal `export-rest.png` / `export-hold.png`. Big Ben pixels, logs and model data stay local and are not committed. Source credit for the person is in [asset credits](ASSET_CREDITS.md).

This result restores lightweight subject/background separation on generated skies. It does not restore different clock-wall perspectives or subject self-parallax; those belong to the preserved independent geometry experiment.
