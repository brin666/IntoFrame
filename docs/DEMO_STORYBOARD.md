# IntoFrame submission film

The Remotion composition `IntoFrameDemo` renders a 63-second film at 1920 × 1080 and 30 fps. It appears at `/demo.html`; the downloadable render is `/demo/IntoFrame-demo.mp4`.

## Storyboard

| Time | Segment | Picture and copy |
| --- | --- | --- |
| 00:00–00:04 | Intro | “From one photo. IntoFrame. Make your photos come alive.” |
| 00:04–00:13 | Pink sample | Tower sample. Reuses the app’s six-second `PhotoReveal`: original source, generated background and subject composite, then cinematic bars. The remaining three seconds hold the result. |
| 00:13–00:20 | Blue Hour | Portrait source with its Blue Hour restyle. This is a second style of that same source photo. |
| 00:20–00:29 | Golden Hour | The same portrait source with its Golden Hour restyle, for a direct style comparison. |
| 00:29–00:38 | Dog sample | Dog source with Dreamy Pink restyle. The existing crop and planar reveal are preserved. |
| 00:38–00:45 | Rocket sample | NASA source with Golden Hour restyle. The subject cutout retains the plume and the preserved scene retains the launch site; the shuttle is a small, distant detail. This is a planar reveal. |
| 00:45–00:55 | Browser interaction | Plays the real `/demo/interaction.webm` screen recording. The caption reads “Relative depth · bounded 2.5D parallax” and identifies it as a one-off local depth inference, not full 3D reconstruction. |
| 00:55–01:03 | Closing | Repository address and all four sample photo attributions. The Tower credit includes source and CC BY-SA 3.0 license URLs. |

Photo reveals use the existing `PhotoReveal` component and scale each complete native-resolution composition proportionally into its panel. The film contains no generated 3D scene, added music, fake browser footage, or runtime model claims. Sample images are precomputed local assets. The web Player begins paused; play, pause, scrub, and MP4 download are available at `/demo.html`.

## Sample assets and credits

The render reads `public/samples/manifest.json` (version 1). The final film requires `tower`, `portrait`, `dog`, and `rocket`. Each selected photo uses the manifest’s local source image, matching subject and background layers, composition values, and selected style output. The web page checks these public asset paths and the interaction recording before it enables the Player. Missing rendered inputs cause the Remotion composition to fail; it does not substitute a mock scene.

The Tower source photo is credited in its chapter, the closing card, and the web page footer:

> Tower photo: Massimo Catarinella · CC BY-SA 3.0  
> https://commons.wikimedia.org/wiki/File:BigBenLondon.jpg

The MP4 derivative and its tower-based `public/demo/interaction.webm` browser recording are distributed under CC BY-SA 3.0. This applies to these media assets, not to the repository’s source code. Other sample attributions and license links come from each sample’s `source` metadata.

## Render and open

```powershell
npm run demo:render
npm run build
npm run dev
```

Then open `http://127.0.0.1:5187/demo.html`. `npm run demo:render` writes `public/demo/IntoFrame-demo.mp4`; it requires `public/demo/interaction.webm` and all referenced sample assets to exist. The Remotion entry point is `src/remotion/submission-entry.ts`, and the composition id is `IntoFrameDemo`.
