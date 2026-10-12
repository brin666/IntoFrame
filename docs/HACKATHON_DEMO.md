# IntoFrame hackathon demo package

## Start here

The complete submission is on branch `demo/hackathon-submission`. Clone that branch as shown in the README, run `npm ci` and `npm run dev`, then open `http://127.0.0.1:5187/demo.html`.

The public package contains:

- Four actual processed architecture photos: Big Ben, Taipei 101, Flatiron Building and Qutub Minar. Portrait, dog and launch assets remain historical; they are no longer in the gallery or film.
- Three cached styles per photo: Dreamy Pink, Golden Hour and Cinematic Night (blue hour).
- Original source/alpha, lossless RGB layers and native float32 relative depth, so the sample page uses the production spatial renderer.
- A 150-second (2:30) 1920×1080, 30 fps Remotion MP4, editable composition, real 30-second workflow and 16-second architecture interaction recordings.
- A paused webpage Player with playback, timeline scrubbing, source credits and MP4 download.

Examples need no GPU/backend setup. New uploads need the documented local Python/CUDA setup. The supplied MP4 is already rendered; rendering again is optional:

```sh
npm run demo:check
npm run demo:studio
npm run demo:render
```

`demo:render` uses an installed Chrome on Windows when available. Set `REMOTION_BROWSER` to a specific Chrome executable if needed. The renderer runs two concurrent browser frame workers and local H.264 encoding. Models are never called while playing or rendering the film. The bundled inputs and recording are local; no image-generation API subscription is required.

## Two-and-a-half-minute presentation notes

| Time | Say / show |
| --- | --- |
| 0–8s | Introduce IntoFrame and the architecture contact sheet. |
| 8–38s | Real upload, local analysis, Generate, reveal, Before/After and PNG download. Processing waits are shortened by cuts; actions play at normal speed. |
| 38–56s | The original Big Ben photo becomes a styled, cinematic pop-out frame. |
| 56–72s | Compare the actual three styles for Big Ben. Each holds before a short crossfade. |
| 72–96s | Show Taipei 101, Flatiron Building and Qutub Minar with their original-to-result transitions. |
| 96–114s | Inspect RGB, alpha and relative depth, then expand and rejoin the actual 2D compositing layers. This diagram does not claim full 3D reconstruction. |
| 114–130s | Trusted mouse input on two buildings drives the production bounded depth preview. |
| 130–150s | Repository, architecture photo credits and license URLs. |

The movie cannot preserve real-time interaction. The sample web page is the interactive experience; the recording and movie demonstrate it.

## Architecture selection and current limits

Taipei, Flatiron and Qutub each went through real upload, segmentation/sky analysis, depth and all three restyles. The prior Big Ben assets are reused unchanged. The film selects usable default styles rather than asserting every output is visually successful: Taipei Golden Hour has a repeated sky band and is not shown. Flatiron retains the original street and people; distant roof/tree edges can have cyan seams. Qutub retains the foreground ruins and a small airplane whose edge is imperfect. Lighthouse mask validation failed; Space Needle's lattice contour was rejected for this edit. These failures are documented in [DEMO_ASSETS](DEMO_ASSETS.md).

The new film adds no camera strength, model or product feature. Its generated sky remains a distant plane, while original native float32 depth drives the subject and retained scene. It cannot infer unseen building sides or reconstruct nighttime illumination.

The actual workflow recording submits the credited Big Ben RGB source to `/api/jobs` and `/api/restyle`; no backend response is intercepted. Two normal-speed architecture captures use trusted drag/release input. A cursor marker follows events and never overrides the camera. Reproduce them with `node scripts/capture-architecture-demo.mjs` against a running backend. The bundled movie and Player use the saved media and call no models.

Current render and browser results are recorded in [render metadata](demo/render.json), [browser checks](demo/browser-checks.json), [real capture evidence](demo/architecture-capture.json) and [the contact sheet](demo/film-storyboard.jpg). These records distinguish functional checks from visual judgment. `demo:render -- --stills` checks chapters before full encoding; full renders first go to an ignored candidate, validate duration/frame count, then replace the public movie. The previous movie is preserved locally.

The final local frontend passed 66 checks: all four native depth meshes, twelve matching style layers, untouched Before, transition replay/skip, centered PNG byte identity during the reveal, trusted drag/release within source-cut travel caps, zero sample inference requests, the 150-second Player timeline and six chapter seeks, served MP4 hash equality and the preserved experiment HTML. Focused computation checks passed: scene motion 14, depth geometry 9, compositing 6 and native depth contract 5, plus the reveal endpoint/group-fade checks. The encoded movie is H.264, 1920 × 1080, 30 fps, exactly 4,500 frames / 150 seconds; its size and hash are in the render record. These checks do not assert universal visual quality or physical phone/display FPS.

A fresh detached worktree of `0ef8bbb8b54ee20da7244c3c75736f3981bb3362`, without the local Python environment or model cache, passed `npm ci`, `npm run build`, the unchanged asset inventory check and the same 66 browser checks on a frontend-only Vite preview at port 5198. No sample/API requests were made. See [clean-checkout results](demo/clean-checkout-browser.json). The remote commit's MP4 was downloaded back from GitHub and matched the local 10,633,772-byte file and SHA256 `917275a5e60480971237289268fd02588337b9dc0bdb6cbef4ea98b174cd1143`.

## Verification and reproduction

The current browser report and render metadata linked above identify the actual checks and output. Build/resource checks are separate from the visual review: Taipei Golden Hour and the rejected candidate photos are not visual passes.

With the frontend running, set `INTOFRAME_URL` if using a different port:

```sh
npm run demo:verify
npm run demo:check
```

The browser script exercises all twelve cached styles, original Before, PNG byte identity during the reveal, trusted drag/release, Player play/pause and chapter seeking, MP4 hash equality and the old experimental entry. Sample playback must make zero backend API requests. Screenshots stay in ignored `screenshots/submission-browser/`. Run `demo:check -- --update-hashes` only after an intentional media update; regular checks do not change tracked inventory.

To capture the new recordings against the real local backend:

```sh
node scripts/capture-architecture-demo.mjs
npm run demo:render -- --stills
npm run demo:render
npm run build
```

Processing waits are shortened by normal-speed cuts, never by fake progress or substituted API responses. The script uses bundled FFmpeg input seeking and concat rather than unavailable video filters. New uploads/generation require the existing GPU backend; the Player and cached samples need only the frontend.

The earlier 63-second, portrait/pet/launch film and its 55-check verification belong to commit `c0633a1` and its parent package. They are historical results, not this film's acceptance evidence.

Only credited public photographs, derivatives and recordings are published. Private uploads, weights, logs and caches remain excluded. The new movie and recordings use [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), retaining all photo attributions. This does not license project-authored source code or alter the model licenses documented in [THIRD_PARTY](THIRD_PARTY.md). Public GitHub upload is not a contest-platform submission.
