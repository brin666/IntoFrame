# Gentle automatic motion and drag takeover

IntoFrame now presents a gentle moving photo, lets a stationary press freeze the current view, follows horizontal dragging, and softly returns to automatic motion on release. The original upload and generated After share this behavior once their native depth scene is ready. This is still shallow single-photo 2.5D relief.

## Local runtime

The existing environment was intact: Python 3.11.9, PyTorch 2.11.0+cu128, CUDA available and NVIDIA RTX 4060 Laptop GPU. The reported interpreter failure came from the execution sandbox being unable to launch the environment's original Python outside the workspace. Verification with the permitted original interpreter succeeded; no installation, environment deletion, global security change or cloud deployment was performed.

The original single-origin helper is running at `http://127.0.0.1:5190/`; page and `/api/health` return 200. It serves both the built frontend and the real local GPU API, so a separate port 8000 process is not needed. Restart from the repository root if required:

```powershell
.\scripts\start-local-preview.ps1
```

The launcher checks the existing preview first, then starts the same `.venv` and helper in a hidden background process with logs in `screenshots/local-runtime/`. It was verified by replacing only this task's identified foreground preview process and receiving page/API 200 again. To run in a terminal instead, use `.\.venv\Scripts\python.exe scripts\serve-subject-experiment.py`. First upload after a server restart can spend time loading cached models.

## Interaction contract

- Default automatic horizontal parallax uses 35% of the existing safe camera travel and a 16-second cycle. It uses the native subject mesh, preserved scene and distant sky; it does not translate the whole photo with CSS.
- Press captures the current camera position and pauses the automatic phase. Keeping the pointer still keeps the view still. Horizontal drag follows the pointer within the same source-cut/overscan bounds; the input lives in a ref, without per-frame React state updates.
- Release preserves the pose and blends back into automatic motion over roughly two seconds. Repeated gestures start from the current pose. Actual camera Z stays fixed, avoiding a press-induced zoom or stretch.
- Desktop mouse captures immediately. Touch waits for horizontal intent; `touch-action: pan-y` allows normal vertical page scrolling. Captured horizontal dragging can continue outside the frame within the same safe bounds.
- Pointer cancellation/loss ends drag. Scene/photo/style switches clear the pointer. Before, mask inspection, generation, reduced motion and hidden/unfocused pages pause motion. Missing/weak/invalid native depth or renderer loss remains a clear static fallback.
- PNG is the centered still composition and remains independent of automatic or dragged camera state.

Two integration defects were found during acceptance and fixed: changing camera Z when pressing caused a small zoom jump; transferring implicit touch capture from a child layer to the stage emitted a bubbled child capture-loss event that incorrectly ended the drag. The final implementation keeps Z fixed and reacts only to actual stage capture loss.

## Cached sample for personal review

Open the normal local URL for real uploads. To quickly inspect the same saved real photos and generated skies without running models, use the optional sample launcher:

```powershell
node scripts\open-local-demo.mjs --case bigben
```

The launcher opens an interactive Chrome window on the current local frontend, loads the hash-checked saved Big Ben source/depth/Night sky and labels it **Cached local sample**. Its API/media replay stays in that browser context; the normal server's upload/generation behavior is unchanged. It never records a video, performs inference or sends private inputs externally. Uncaptured photos/styles are rejected rather than triggering generation. Close its browser to exit. Dog and Paris are available with `--case dog` and `--case paris`.

A simple review/recording path is: observe the gentle motion for a few seconds, press without moving, slowly drag left then right, release, compare Before/After, and download PNG. Record only when you choose to do so; this task did not record or upload competition material. The cached viewer is not evidence of live generation speed.

## Verification and evidence

Current evidence is local under `screenshots/drag-motion-fix/`. Browser replay uses the exact source, mask, native depth and saved sky files from `screenshots/depth-motion-fix/manifest.json`; no new sky generation is run. Current screenshots use real mouse/CDP touch input and native browser timestamps; they do not assign camera state or replace requestAnimationFrame.

- Production TypeScript/Vite build passed. Fourteen controller behavior cases, sixteen parallax checks and nine depth-geometry checks passed.
- Independent source review found no remaining confirmed integration defect after the camera/capture fixes.
- One real local GPU upload test passed in `live-upload/results.json`: original native mesh, default camera motion, stationary press, directional bounded drag and resumed automatic motion; one upload/depth submission and no restyle submission or browser error. This ran before the final touch-capture-only App fix; the backend, desktop controller and scene bundle were unchanged by that fix. Final-build desktop and touch checks are recorded separately below.
- The sample launcher smoke checks passed for Big Ben, dog and Paris; screenshots/records are in `demo-smoke/`.
- The authoritative browser index (local-only evidence: screenshots/drag-motion-fix/browser-evidence-index.json) contains six final-build desktop/touch cases for Big Ben, dog and Paris: **272 checks and 155 screenshots, all passing**. It records hashes, default/drag/release behavior, repeated interaction, lifecycle/view/style changes and six identical automatic/drag PNG byte pairs. Native mobile vertical scrolling moved 190, 181 and 93 pixels respectively. Earlier failed mobile pilot results record the resolved capture-transfer defect and are superseded by final runs.
- Fault checks (local-only evidence: screenshots/drag-motion-fix/faults/results.json) passed for missing raw depth, background context loss during automatic motion and subject context loss during dragging. They verify a centered static preview, visible DOM subject and released interaction. No JavaScript error occurred.
- Measured local displacement (local-only evidence: screenshots/drag-motion-fix/visible-motion-measurements.json) tracks actual final-build Big Ben drag screenshots at camera X ±0.01989, fixed Z 3.5 and unchanged photo composition. Front clock, side clock and corner moved by median −16.842, −15.912 and −18.060 pixels: a 2.148-pixel regional spread. This supports nonuniform visible depth motion, not accurate recovered 3D geometry. The comparison image (local-only evidence: screenshots/drag-motion-fix/drag-comparison.png) provides visual context.

Focused reproduction commands:

```powershell
node scripts\test-scene-motion.mjs
node scripts\test-parallax.mjs
node scripts\test-depth-geometry.mjs
node scripts\drag-motion-browser.mjs --base http://127.0.0.1:5190 --include bigben,dog,paris --out screenshots/drag-motion-fix/recheck
```

The older [depth/hold report](DEPTH_MOTION_REPAIR.md) retains its own checkpoint hashes and evidence; static-rest/release assertions from that old harness do not describe the new default behavior. Final delivered bundle/source hashes are recorded beside current browser results and in the delivery version record. All code remains on the local `fix/sky-boundary-contamination` working tree; no commit, merge, push, publication or contest submission was performed.

## Remaining limits

User visual acceptance and physical phone performance remain open. Touch checks use browser emulation, not a real phone. Native relative depth cannot recover accurate orthogonal walls, hidden backsides or missing scenery. Motion remains intentionally subtle; a tightly cut photo can have one-sided or no safe travel. Existing sky-edge color and Eiffel opening limitations, and the dog's inherited cached sky patch, are not fixed by this interaction change. Live Photo/video export remains outside this scope.
