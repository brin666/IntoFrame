# IntoFrame hackathon demo package

## Start here

The complete submission is on branch `demo/hackathon-submission`. Clone that branch as shown in the README, run `npm ci` and `npm run dev`, then open `http://127.0.0.1:5187/demo.html`.

The public package contains:

- Four actual processed photos: tower, beach portrait, dog and NASA launch scene.
- Three cached styles per photo: Dreamy Pink, Golden Hour and Cinematic Night (blue hour).
- Original source/alpha, lossless RGB layers and native float32 relative depth, so the sample page uses the production spatial renderer.
- A 63-second 1920×1080, 30 fps Remotion MP4, the editable composition and a genuine 10-second browser interaction recording.
- A paused webpage Player with playback, timeline scrubbing, source credits and MP4 download.

Examples need no GPU/backend setup. New uploads need the documented local Python/CUDA setup. The supplied MP4 is already rendered; rendering again is optional:

```sh
npm run demo:check
npm run demo:studio
npm run demo:render
```

`demo:render` uses an installed Chrome on Windows when available. Set `REMOTION_BROWSER` to a specific Chrome executable if needed. The renderer runs two concurrent browser frame workers and local H.264 encoding. Models are never called while playing or rendering the film. The bundled inputs and recording are local; no image-generation API subscription is required.

## Sixty-second presentation notes

| Time | Say / show |
| --- | --- |
| 0–4s | “IntoFrame makes your photos come alive.” |
| 4–13s | “Start with one ordinary photo. AI separates the subject and generates a new sky. The subject crosses the cinematic frame.” |
| 13–29s | “Choose an atmosphere while keeping the original person and non-sky environment.” Show Blue Hour and Golden Hour. |
| 29–38s | “Pet fur is preserved. Dense foliage is still a difficult sky boundary.” |
| 38–45s | “The launch scene keeps the original plume and ground. Only the confirmed sky is replaced.” |
| 45–55s | “This is real browser input. A one-time relative depth prediction drives limited spatial parallax; drag to explore and release to return to the gentle drift.” |
| 55–63s | “Download the centered static PNG, or open the included examples and explore for yourself.” Show repository and credits. |

The movie cannot preserve real-time interaction. The sample web page is the interactive experience; the recording and movie demonstrate it.

## Actual checks and limits

The samples came from four complete upload → segmentation/sky analysis → depth → three restyle API sequences (105.81s combined on this machine). This is evidence of actual inference, separate from frontend sample replay. Inputs are capped at1024px for repository size. Source licenses, model pins, seeds and output hashes are documented in [DEMO_ASSETS](DEMO_ASSETS.md).

Python checks passed: atmosphere7, restyle scheduling7, compositing6, sky layers6, native depth contract5. Browser math/controller checks passed: parallax16, scene motion14 and depth geometry9; the reveal endpoint/group-composite checks also passed. These verify computation and resource contracts, not universal image quality or display FPS.

The film’s portrait horizon has a thin seam, foliage around the dog contains visible sky-mask artifacts, and the NASA scene has a small horizon artifact. These remain documented limitations; the tower is the main hero case. Tone balancing does not reconstruct nighttime illumination or change original daylight shadows. The subject is a shallow relative-depth surface, with no unseen back side or complete physical building reconstruction.

The actual interaction was recorded from `/?sample=tower` with trusted mouse input. Camera positions came from the existing renderer and controller, never from a test-injected camera. The cursor indicator only follows pointer events. No `/api/` requests occurred while recording.

The final production frontend passed55 browser checks: all four bundled native meshes, all twelve styled layer identities, untouched Before, transition replay/skip, four centered PNG byte-identity comparisons during transitions, trusted drag/release, zero backend requests, Player play/pause, MP4 byte identity and preserved experiment HTML entry. Final output metadata verified with ffprobe: H.264,1920×1080,30/1fps,1890frames,63.000s,6,014,065bytes. Its SHA256 is `43ad44dbea3ac6b1b8a7be10862405e7215222d90758870691ba80b135aca0c7`.

Actual rendered frames are available in [the film contact sheet](demo/film-storyboard.jpg). Title escapes and portrait-panel layout found during review were fixed and the full film was rendered again. Earlier diagnostic movies remain local/ignored and are not part of the submitted package.

Clean checkout verification used an isolated Git worktree of the packaged commit, with no local model files or Python environment: `npm ci`, `npm run build` and resource checks passed. Its frontend-only Vite preview on port5198 passed the same55 checks and made zero `/api/` calls. The original local preview remains on port5190. The published [browser acceptance record](demo/clean-checkout-browser.json) and [render record](demo/render.json) contain only safe demo metadata. Run `demo:check` normally to validate the saved asset inventory without modifying tracked files; `demo:check -- --update-hashes` explicitly refreshes that inventory after intentionally replacing public samples.

The public artifacts omit user uploads with unverified rights, raw local job logs, caches, model weights and secrets. The source code's existing license status is recorded in [THIRD_PARTY](THIRD_PARTY.md); the attributed tower derivatives, recording and film have separate CC BY-SA terms.

## Evidence commands

With the frontend running, set `INTOFRAME_URL` if using a different port:

```sh
npm run demo:verify
```

This exercises all twelve precomputed styles, original Before, PNG identity during transition, real drag/release, Player play/pause, served MP4 hash and the old experimental entry. It asserts that sample playback creates no backend API requests. Browser records/screenshots are local under ignored `screenshots/submission-browser/`.

To record again, run `node scripts/capture-submission-interaction.mjs`; then render and build. Replacing the samples requires real local GPU processing using `scripts/prepare-submission-samples.py`, as described in the asset document. The included assets avoid that wait for judges.
