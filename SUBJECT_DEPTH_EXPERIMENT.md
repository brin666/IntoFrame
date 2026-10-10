# Subject Depth Mesh experiment (Phase 2.5)

This page is a local A/B lab. The normal `/` page and its DOM foreground remain unchanged.
The default Big Ben job is `d81c42515e92447b93fa4f0431d53eb7`. Its media are gitignored;
for another upload, pass its job ID as `/experiment.html?job=<id>` after preparing float depth.

## Run

From `D:\hks` with the project's virtual environment:

```powershell
.\.venv\Scripts\python.exe scripts\prepare-subject-depth-experiment.py <job-id>
& 'D:\nodejs\npm.cmd' run build
.\.venv\Scripts\python.exe scripts\serve-subject-experiment.py
```

Open `http://127.0.0.1:5190/experiment.html?job=<job-id>`. The local server includes
the existing FastAPI routes, local media and built frontend. The Big Ben short URL
`http://127.0.0.1:5190/experiment.html` works on this machine.

The preparation script runs the same pinned Depth Anything V2 Small checkpoint and
bicubic resize as `backend/depth_estimator.py`. It writes `subject-depth-f32.bin` as
little-endian, row-major float32 at source dimensions and a matching JSON manifest.
Larger predictions mean nearer surfaces, but values are relative and have no metre
scale. The 1426×1600 Big Ben binary is 9,126,400 bytes. It exactly matched the
previous independent float32 diagnostic array (`max_abs_diff=0`). The production
8-bit `depth.png` and `/api/depth` are unchanged.
Only the geometry display mapping clamps to subject p05–p95. In the inspected
clock-front, clock-side and middle-corner mask regions, no pixel hit the upper
clamp; the corner region had no lower-clamped pixels either. The earlier 8-bit
p98 saturation at the corner does not recur in this experiment.

## Geometry and composition

- Mode A uses the current whole-image DOM `subject.png` projection at a representative
  virtual foreground distance. Mode B hides it completely and renders a Three.js
  subject mesh with the same image as an alpha texture. Mode C shows mesh normals
  and wireframe instead of the photo texture. All modes use one camera state.
- A 4-pixel grid samples the original float32 prediction. A 3×3 local mean reduces
  interpolation ringing. Only the largest connected mask region is used; triangles
  crossing the mask boundary or a raw-depth jump above 0.55 are omitted. Alpha is
  still sampled from `subject.png` per fragment. This prevents large triangle
  bridges but can erode thin ornaments.
- With camera distance `C=3.5` and FOV `35°`, the approximate focal length is
  `f=H/(2 tan(FOV/2))`. A source pixel `(u,v)` with chosen virtual distance `D`
  becomes `(X,Y,Z)=((u-cx)D/f,(cy-v)D/f,C-D)`. At the center view, perspective
  projection returns `(u,v)`, preserving source UVs. Relative prediction is mapped
  conservatively to `D=2.55-strength*(near-0.5)*0.4`, with `near` based on subject
  p05–p95. Even at 1.6× debug strength, subject distance stays at or below 2.87;
  the nearest background grid distance is 2.88. This is a virtual display range.
- The existing padded, inpainted background and 8-bit render-depth mesh are drawn
  through a 13%/74%/13% scissor aperture. The subject mesh is drawn in a later pass
  across the full stage, so it remains over DOM black bars. Both passes use one
  PerspectiveCamera, translated horizontally with a damped spring and small
  tracking correction. The DOM PNG is hidden in Modes B and C.
- Fixed Left/Center/Right views use target camera x = −0.06/0/+0.06 by default.
  Holding runs a bounded sway; release settles to the selected fixed view.

## Big Ben test, 2026-10-10

```powershell
& 'D:\nodejs\node.exe' scripts\subject-experiment-browser.mjs
.\.venv\Scripts\python.exe scripts\measure-subject-motion.py
py -3.11 scripts\subject-experiment-montage.py
$env:INTOFRAME_URL='http://127.0.0.1:5190/'
& 'D:\nodejs\node.exe' scripts\spatial-browser-smoke.mjs
```

The browser test captured Flat and Depth at all three fixed views plus a Geometry
Debug center view. Images, a short hold clip, contact sheets and JSON measurements
are under gitignored `screenshots/subject-depth-experiment/`.

At a 677×760 stage, Lucas–Kanade feature tracking from Left to Right gave:

| Mode | Front clock median Δx | Left clock median Δx | Corner median Δx |
| --- | ---: | ---: | ---: |
| Flat | −56.66 px | −56.67 px | −56.67 px |
| Depth | −53.13 px | −50.15 px | −55.11 px |

The tracked regions are manually selected screen boxes. These numbers measure
visible motion, not 3D reconstruction accuracy. Different Depth shifts confirm
that the subject is no longer one translating PNG. The clock regions differ by
about 3 px over the complete ±0.06 camera swing. At normal preview size this is
subtle; both walls still resemble a shallow curved sheet more than a clearly
folded building. The normal-color debug view suggests different local
orientations, but the textured view does not produce a strong wall-perspective
change. Center composition stays close to the original photo.

Visible defects: small BiRefNet flecks near the roof/sky remain, and a few narrow
mask-boundary parts are lost by triangle rejection. The bounded default views show
no large duplicate tower or black void. A separate 1.6× relief / ±0.10 travel
stress capture still did not produce a clear two-wall fold; it enlarged motion
without making the inferred wall planes convincing. The Telea fill is only suitable
for limited disocclusion, so these stress settings are not product defaults.

The browser test reported 143,558 grid vertices, 87,814 retained triangles,
197,786 discarded boundary/depth triangles, no JavaScript page errors, camera
x ≈ −0.06/0/+0.06, and return to 0 after release. Headless Chrome produced 239.1
animation callbacks/s with a 4.3 ms p95 callback interval during a 2.2 s hold.
This measures browser scheduling, not GPU frame time or visible 240 Hz output.
The production spatial smoke test passed through the local built server,
including mobile pointer and reduced-motion checks. `npm run build` passed.

**Decision:** The float-depth mesh proves a real local parallax signal, but does
not meet the product criterion of an unmistakable two-wall perspective change.
The next smallest validation would estimate normals and fit two wall planes
around the clocks/corner, then compare the same fixed views against this
untouched baseline. An explicit geometric model such as MoGe is a later research
option. Neither alternative was implemented in this experiment.
