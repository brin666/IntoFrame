# Public demonstration assets

These historical reviewed samples and their locally generated derivatives are distributed in `docs/examples/`. The newer public examples and standalone demo film are separately recorded in [DEMO_ASSETS](DEMO_ASSETS.md) and [DEMO_STORYBOARD](DEMO_STORYBOARD.md). User-uploaded photographs with unverified source rights, their local screenshots, weights, logs and caches are excluded from Git. Only the attributed public-source submission film/recording under `public/demo/` is distributed.

| Asset | Original source / credit | Source status |
| --- | --- | --- |
| `astronaut-before-after.png`, `astronaut-export.png`, `astronaut-edge-hair.png` | NASA photograph of Eileen Collins, distributed as scikit-image `data.astronaut()` | scikit-image documents it as public domain with no known copyright restrictions. |
| `chelsea-before-after.png` | Chelsea the cat, Stefan van der Walt, scikit-image `data.chelsea()` | CC0 by the photographer. |
| `coffee-boundary-before-after.png` | Rachel Michetti; photograph courtesy of Pikolo Espresso Bar; scikit-image `data.coffee()` | CC0 by the photographer. |

Source documentation: [astronaut](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut), [Chelsea](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.chelsea), [coffee](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.coffee). NASA's [media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) remain relevant. These are technical demonstrations; NASA and the named people/businesses do not endorse IntoFrame.

The backgrounds were actually generated locally with the pinned SD1.5 Inpainting model. RGB cropping/grading, alpha edge recovery, film bars and PNG export were then applied by the application. These are processed derivatives, not original source photographs. Source-image rights, third-party model terms and project code licensing are separate; this document does not grant a new blanket license to all repository content.

`acceptance-metrics.json` contains only public sample measurements, parameters and seeds. It has no local paths, job URLs or private building image data. Public illustrations show genuine successes **and limitations**; coffee is explicitly a scene-relationship failure and the close-cropped cat is not a recommended hero demonstration.
