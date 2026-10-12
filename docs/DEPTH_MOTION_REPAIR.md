# Native subject depth and original-upload hold

This report records the native-depth/hold checkpoint. The later default automatic motion and drag takeover are documented in [Local interaction finish](LOCAL_INTERACTION_FINISH.md); the bundle hashes and browser counts below remain evidence for this earlier checkpoint.

The local repair enables hold on the uploaded original and gives the original and generated After a bounded depth surface. At the same camera positions, the captured Big Ben clock/corner regions now move by different amounts rather than translating as one flat cutout. This is shallow 2.5D relief from a single photo; it does not establish accurate building geometry or unseen surfaces.

## Version and scope

- Checked on 2026-10-11 UTC, branch `fix/sky-boundary-contamination`, base commit `a2180d18433e5c0979102dff6a6e5819cc477454`.
- The repair remains uncommitted in this working tree. No merge to main or push was performed. Main remained at `d58406a3a73485033869adb4eca6d8012749513f` when inspected.
- Current local built preview: `http://127.0.0.1:5190/`. The isolated `/experiment.html` remains available.
- Served main bundle: `main-Bw-EwPjd.js`, SHA256 `06a939868c861ca12c24dfbef00517ba5b576c94708bf74da2b7dfc9f5877adb`. Each browser result records the actual delivered bundle hashes and the workspace source hashes.
- The prior sky-boundary repair, sky synthesis/compositing, subject alpha, model pins and still PNG export logic were not changed by this repair. `vite.config.ts` excludes generated evidence/media from its watcher after a Windows EBUSY failure while an export was being written.

## Changed behavior

`POST /api/depth` uses one Depth Anything prediction to retain the compatible 8-bit depth assets and add a native float32 little-endian row-major signal, subject percentile metadata and eligibility diagnostics. The browser rejects incompatible dimensions, invalid samples and unreliable subject ranges.

The alpha-textured subject is a complete indexed mesh; thin features are not removed by triangle rejection. Local relief is bounded to +/-0.36 around the representative subject depth, with smoothing and slope limits. The subject and preserved scene sample the same surface so their support/contact coordinates agree. Generated sky stays on its distant plane: old road/building depth is never imposed on new sky. Projection and texture sampling preserve the centered still composition.

Hold is available after the current original or After scene is ready. Before, mask inspection, generation and reduced-motion preference stay still. Switching a photo/style/view, release, pointer cancellation, leaving the stage and blur cancel hold. Travel uses actual nearest mesh depth and source-cut safety; the old original-only amplitude penalty was removed, while the existing desktop/touch separation targets remain.

Missing/weak native depth, asset failure or either WebGL context loss restores the DOM static layers, hides both motion canvases, disables hold and shows a reason. Still PNG export remains centered and independent of camera motion.

## Evidence and interpretation

All evidence paths below are local and gitignored under `screenshots/depth-motion-fix/`. Browser replay uses captured API results and exact local media. It does not run new inference or diffusion. Fixture preparation ran one local depth inference on each exact source photo; cached sky, scene and subject assets were copied unchanged. A separate real upload test exercised local segmentation/sky detection/depth without restyling.

| Evidence | Location | What it establishes |
| --- | --- | --- |
| Frozen source, mask, depth, sky/scene hashes and model revisions | `manifest.json` | Same input and cached generated background are used in the comparison. |
| Original and After rest, natural hold, release and matched-camera screenshots | `verified-after-desktop/<case>-desktop/`, `verified-*-mobile/` | Actual rendered composition and local motion, on desktop and touch emulation. |
| Complete recorded Big Ben interaction | `verified-after-desktop/bigben-desktop/hold-demo.webm` | Upload hold, After hold, comparisons and UI interaction in the tested browser. |
| Actual new upload | `live-upload/results.json`, `live-upload/original-rest.png`, `live-upload/original-hold.png` | Ready native mesh after real local inference, nonzero hold, settled release and no restyle call. |
| Renderer faults | `verified-renderer-faults/summary.json` | Subject and background context loss while held, and missing native depth, both restore a static usable preview. |
| Authoritative case/check index | `browser-evidence-index.json` | Six full desktop/touch runs, supplemental faults and baseline checks; superseded attempts are explicitly excluded. |
| Corrected old cancellation checks | `baseline-cancellations/summary.json` | Old cancellation behavior did not have the apparent pointer-leave regression. |
| Local feature tracking | `visible-motion-measurements.json` | Nonuniform pixel motion at matching camera positions; not 3D reconstruction accuracy. |
| Side-by-side matched-camera contact sheet | `matched-camera-comparison.png` | Previous/current composition from actual browser screenshots, with equal camera travel. |

The original camera comparison screenshots remain in `baseline-browser/bigben-desktop/` and the corresponding final screenshots in `after-final/bigben-desktop/`. Both use camera X positions +/-0.02 and a 604 x 678 stage. Lucas-Kanade tracking over three clock/corner regions gives:

| Render | Front clock median dx | Side clock median dx | Corner median dx | Region spread |
| --- | ---: | ---: | ---: | ---: |
| Previous flat subject | -17.354 px | -17.246 px | -17.262 px | 0.108 px |
| Native depth subject | -17.068 px | -16.215 px | -18.244 px | 2.029 px |

This matched-camera result separates local deformation from merely increasing camera amplitude. Measurements use actual screenshots, with more than 100 valid feature tracks per region. `scripts/measure-depth-motion.py` reproduces the measurement. The visual effect is still subtle and does not convincingly reconstruct two orthogonal walls.

Earlier replay records contain an invalid pointer-leave test: moving to y=2 was still inside a stage whose top was y=0. These failures are harness artifacts, not product bugs. The authoritative `verified-*` records use a measured position outside the stage and assert that it is outside. Matching-camera screenshots from earlier runs remain useful; their failed cancellation verdicts do not.

## Validation

- Production TypeScript/Vite build passed.
- Five depth-contract tests passed: single inference, legacy normalization/coordinates, finite native samples, subject diagnostics and wire encoding.
- Nine geometry checks passed: native decoding/rejection, full-grid coverage, centered projection, shared contact geometry, local motion at fixed camera and cut-safe travel.
- Sixteen existing parallax checks and seven sky-refinement regression tests passed.
- Real HTTP upload/local inference passed at port 5190: geometry `depth-mesh`, hold camera X `0.02753`, release `0.00007`; one upload and one depth submission, no restyle submission or browser JavaScript error. Cold model loading is still noticeable; this was not an instant-load timing benchmark.
- All six full browser replays passed: Big Ben desktop/touch 72 each, dog 55 each and Paris 55 each, totalling 364 checks. Two renderer-fault supplements passed 51 each (102 checks); corrected baseline cancellation coverage passed 214 checks. PNG bytes match between rest and hold; Before/reduced-motion views stay still; normal runs have no browser errors and no inference request during hold. The machine-readable `browser-evidence-index.json` records individual verdicts, actual bundle hashes and excluded stale attempts.

Focused checks can be run without diffusion:

```powershell
.\.venv\Scripts\python.exe scripts\test-depth-contract.py
node scripts\test-depth-geometry.mjs
node scripts\test-parallax.mjs
.\.venv\Scripts\python.exe scripts\test-sky-refinement.py
npm.cmd run build
node scripts\depth-motion-browser.mjs --base http://127.0.0.1:5190 --manifest screenshots/depth-motion-fix/manifest.json --out screenshots/depth-motion-fix/recheck
```

The browser command requires the existing local manifest/media; it does not download private inputs. `prepare-depth-motion-fixtures.py` is a local evidence-preparation helper, not a production or paid-generation job.

## Remaining visual acceptance

User visual acceptance and physical-phone performance remain open. Touch checks use a 390 x 844 browser viewport, not a real phone/display measurement. Relative single-image depth cannot recover occluded backsides or guarantee building geometry. The existing sky repair still has its documented edge/color and Eiffel interior-opening limitations. The dog's cached Night image contains an inherited top-right sky/mask patch; passing motion checks is not approval of that sky result. No private input/evidence was uploaded to an external service or Library.
