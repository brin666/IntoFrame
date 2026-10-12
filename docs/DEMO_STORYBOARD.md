# IntoFrame submission film

The Remotion composition `IntoFrameDemo` is a 150-second film at 1920 × 1080 and 30 fps (4,500 frames). It appears at `/demo.html`; the downloadable render is `/demo/IntoFrame-demo.mp4`. The edit focuses on architecture samples and real browser recordings.

## Storyboard

| Time | Segment | Picture and copy |
| --- | --- | --- |
| 00:00–00:08 | Intro | “From one photo. IntoFrame. Make your photos come alive.” A moving contact sheet introduces the credited building examples. |
| 00:08–00:38 | Browser workflow | Plays `/demo/workflow.webm`, a real upload, processing, comparison and download recording. The middle processing wait is shortened; the UI actions remain at normal speed. |
| 00:38–00:56 | Hero reveal | Uses the existing six-second `PhotoReveal` on the Tower sample, followed by an original-to-composite wipe and a held final composition. The description calls out the planar layers and bars. |
| 00:56–01:12 | Three style outputs | Crossfades the actual Dreamy Pink, Golden Hour and Cinematic Night composites for the same building source. |
| 01:12–01:36 | Architecture montage | Shows the other building samples. Each chapter starts with the sample’s six-second `PhotoReveal`, then compares the original with its actual saved composite. |
| 01:36–01:54 | Image layers | First places the native RGB source, foreground mask and relative depth map side by side. Then a labeled 2D diagram separates the styled background/sky layer, cinematic bars and alpha subject cutout vertically, with all layers aligned to the same native image coordinates before they rejoin. The legend says near is light, far is dark, and the estimate is model-relative rather than measured in meters. |
| 01:54–02:10 | Browser interaction | Plays the real `/demo/architecture-interaction.webm` recording of two building samples responding to a drag. The caption reads “Relative depth · bounded 2.5D parallax” and says this is not a full 3D reconstruction. |
| 02:10–02:30 | Closing and credits | Shows `github.com/brin666/IntoFrame`, the architecture sample attributions, and visible source and license URLs. |

The film reuses `PhotoReveal` and the app’s normalized bar height. It scales each complete native-resolution image proportionally around its center, using the sample’s composition pose. The style comparison, source wipe, mask, depth map and browser recordings all use the bundled assets. The film does not add a synthetic 3D scene, describe depth as physical distance, or use music or fabricated UI footage. The web Player starts paused; play, pause, scrub and MP4 download are available at `/demo.html`.

## Sample assets and credits

The render reads `public/samples/manifest.json` (version 1) and selects building samples (`architecture`, `building`, or `landmark` category; known architecture IDs are also accepted). It prefers `tower` as the hero and includes up to four building samples in the film. Each selected sample must provide all three style outputs and native source, mask and depth assets. The web page checks every referenced public file and both recordings before enabling the Player. A missing input is reported; the film does not substitute a mock scene.

The Tower photo is credited in its chapter, the closing card, and the web page footer:

> Tower photo: Massimo Catarinella · CC BY-SA 3.0
>
> Source: https://commons.wikimedia.org/wiki/File:BigBenLondon.jpg
>
> License: https://creativecommons.org/licenses/by-sa/3.0/

Other architecture photo credits and license URLs come from each sample’s `source` metadata. The rendered film and browser recordings are distributed under CC BY-SA 4.0 to accommodate the included adapted sample licensed under that version. This applies to these media assets, not to the repository source code.

## Render and open

```powershell
npm run demo:render
npm run build
npm run dev
```

Then open `http://127.0.0.1:5187/demo.html`. `npm run demo:render` writes `public/demo/IntoFrame-demo.mp4`; it requires the architecture sample assets, `public/demo/workflow.webm`, and `public/demo/architecture-interaction.webm`. The Remotion entry point is `src/remotion/submission-entry.ts`, and the composition id is `IntoFrameDemo`.
