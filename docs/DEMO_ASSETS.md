# Public demo samples

`public/samples/manifest.json` is a version 1 set of real, precomputed API results for the public demo. Each case was uploaded to the running IntoFrame API, passed through depth estimation, and restyled with all three current styles on 2026-10-12 UTC. These files are API outputs, not fixture compositions or hand-drawn thumbnails. The public manifest replaces every runtime `/media/<job>/` URL and job identifier with stable `/samples/<id>/` paths and `sample:<id>` identifiers.

The four source images are prepared at a maximum side of 1024 pixels, EXIF orientation is applied, and the prepared PNG is uploaded. Files reached through the API result URLs are copied byte-for-byte; this includes the float32 little-endian subject depth. The generated thumbnail is a lossless WebP reduction of the chosen style's actual `composite.png`. Only URL-referenced source, mask, subject, sky, depth, background, and style resources are included. Model weights, caches, and job directories are excluded.

## Source and limits

| ID | Source and credit | License | Prepared size | Review notes |
| --- | --- | --- | --- | --- |
| `tower` | [BigBenLondon.jpg](https://commons.wikimedia.org/wiki/File:BigBenLondon.jpg), Massimo Catarinella | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 683 × 1024 | The original crop cuts off the tower at the bottom. The tower edges remain recognizable in all styles. This processed derivative must retain the source credit and CC BY-SA 3.0 terms. |
| `portrait` | [Unsplash image](https://images.unsplash.com/photo-1589869024358-6874d0915b82?w=1600&q=85&fit=max); the local evaluation download did not retain the photographer's name | [Unsplash License](https://unsplash.com/license) | 1024 × 682 | The person faces away and occupies a modest part of the frame. A thin mask seam is visible along the distant horizon. The Unsplash copyright license does not verify model or publicity releases. |
| `dog` | [Unsplash image](https://images.unsplash.com/photo-1552053831-71594a27632d); the local evaluation download did not retain the photographer's name | [Unsplash License](https://unsplash.com/license) | 639 × 1024 | The dog is clear, but sky replacement leaves visibly patchy regions around tree branches and gaps. Keep this as an example of the current sky-mask limit. |
| `rocket` | [NASA image KSC-07PD-2256](https://images.nasa.gov/details/KSC-07PD-2256), NASA | [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) | 681 × 1024 | The shuttle is distant and the exhaust plume carries most of the foreground mask. A small edge artifact remains at the horizon. NASA says its content is generally not subject to copyright in the United States; use the linked media guidelines and do not imply endorsement. |

The Unsplash source image IDs and site license were verified against Unsplash's official license. Unsplash does not require photographer attribution, but the manifest still records that those names were missing from the downloaded test inputs. The rocket uses the NASA/KSC source above. `skimage.data.rocket()` was excluded because its current original Flickr record shows a license that conflicts with the scikit-image page's public-domain note.

The private Big Ben upload previously used for local evaluation is not included. The public tower sample comes from Wikimedia Commons and has its own credit and share-alike terms.

## Inference record

All cases have three complete restyle results with `atmosphereVersion: sky-scene-ambience-v2`. The restyle checkpoint is `stable-diffusion-v1-5/stable-diffusion-inpainting`, revision `8a4288a76071f7280aedbdb3253bdb9e9d5d84bb`. Depth uses `depth-anything/Depth-Anything-V2-Small-hf`; sky segmentation uses `nvidia/segformer-b0-finetuned-ade-512-512`. Seeds and API-reported generation times are preserved in the manifest.

| ID | Dreamy Pink seed / s | Golden Hour seed / s | Cinematic Night seed / s | Full API sequence / s | Published sample bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `tower` | 2596749283 / 4.46 | 1132834330 / 4.48 | 1053453892 / 4.58 | 25.59 | 10,067,725 |
| `portrait` | 2361234801 / 4.40 | 1702716544 / 4.52 | 1800486766 / 4.48 | 26.36 | 16,646,028 |
| `dog` | 3741935636 / 4.01 | 3392245936 / 4.03 | 2233148662 / 4.18 | 26.19 | 17,124,821 |
| `rocket` | 1325206426 / 4.58 | 2085710938 / 4.89 | 683285465 / 4.27 | 27.67 | 11,503,617 |

The sequential four-case run took 105.81 seconds end to end. Restyle times are API-reported model timings; full-sequence times also include upload, depth, polling, media copying, and thumbnail generation.

The four sample directories contain 108 files in total and occupy 55,387,401 bytes. The manifest SHA-256 is `e4562fc5337af2438249cf80f074b9c8e61e0b255ff048132590557722433d83`.

## Selected asset hashes

These SHA-256 values allow the prepared uploads and key published outputs to be checked without exposing local job identifiers. `subject-depth-f32.bin` remains the original API float32 byte stream; its expected byte count is `width × height × 4`.

| ID | Prepared upload PNG | Published `source.webp` | `mask.png` | `subject-depth-f32.bin` |
| --- | --- | --- | --- | --- |
| `tower` | `43a634147142c69fa15223c3eab7c4bf19e4a232961d22b8f395e0894be3cf24` | `4bc996b9e44852591b75bfcd445f5ea1a7ccaa90efa08c2b6560198f8419fc53` | `2d1f438a1350c8e9c6a6d5d4a71ec1f2ea4dfba160860a243dfacf77068e7c25` | `11f778a39da171c4d35b493de4a120cacd8104cdc25b0502cc4b544b1896c3ad` |
| `portrait` | `ab535c1bfffa7da64d0b72a59a26aacd9d26dbb75f54d8f80034b1f53a59b980` | `6115be0716a0049b68f78601ba0aba1f94a2aa7a5eaccf68ca49a8d96601cb93` | `62993598dcf023ab0acf3b5632d3e1b07f3c36999344ff2960f2a65a0dfc8605` | `f6e634fc838d578205327e73a2e7bc04273f8da2e2479666bff3e5804a6738b5` |
| `dog` | `ffbe2ead79e6598e8631cfc3c4f3c39485d5947461e5a1585b5a8bbf626277e2` | `ecd5cb7a735e3117912fa741a095311bc7eaf7092fd7af0e3c276b789be8d7c1` | `cdcd202f28556bdbca7c39f6bde9847c14d2b6fd920a25d03ed79b04fd66501a` | `677a5af2e73944128b8ee32cb0aaf1d7e0dc6dec314caab881e31556febd4ed6` |
| `rocket` | `32902c083a39a715292e4abf30692d613a1d65bed389f04cd828894878aa40f5` | `2d61aef1fc561f9fafc5f6b4b1294c2ed16737bce314b5a95be975737d1ec0ea` | `15e95df77365eadde4da0ed1d95779719ca2cdef5b5ba58aae7367e905233ba8` | `16cd24267f3e96fe4e1d5151b845121035de3f2048d03e31295a2640631ad81c` |

| ID | Dreamy Pink composite | Golden Hour composite | Cinematic Night composite |
| --- | --- | --- | --- |
| `tower` | `c28a878919953d834c3dede62a7f455e2bbbeb3cfe99739a664e5f3342a8a278` | `63a4572e938e0bbe56454978a874d982612ed367482f6b58814911e67ffd1e4d` | `e53e73d2eb8d5b0cdd2c07f7afb9ab0353d05193b6e8802a727884469541d6aa` |
| `portrait` | `a621222b969f98536b92df952152e12c70d09357f4e3d6605d69eb631b8e36f8` | `9d1f5e41dbf3e8b039214f22fb6dfef29165c0b889555bf41f208319a637db61` | `0e02502a8db7886390586a78dc3d8211a955330496a85660f72a9dac0c8c033a` |
| `dog` | `c516a459dec82873011fb2446b20104d1e09b94d88cf41b53364bb9eca9f0625` | `6b5e0ddc9fd85ca36b89d31198c5b36d5259eaaedf5c7b38fc4b2683b7a2e4a4` | `002071f1f0ddf58b517d073c412f9a16c4d592a831a7f133a04e7472d97a063c` |
| `rocket` | `fceafec06a185f98f1a6157cc32e3e67f21872f7fb68f06352d9e86a9c06a0c2` | `f6bb38c12983ebc23176c07a3ec4ec4dacc84bce285c12069fe1fb1337acf134` | `ff38d9b96706f047eb738e2e685a235b2a0da09a28b7886bb3a134dae813d53f` |

## Rebuild and evidence

With the local Python 3.11 environment and the API running at port 5190, regenerate all four cases with:

```powershell
py -3.11 scripts\prepare-submission-samples.py --include tower,portrait,dog,rocket --replace
```

The script submits a fresh upload, depth request, and three sequential restyle requests for each case. It downloads the verified original image when the corresponding ignored local input is absent, applies the 1024-pixel limit, captures the actual API responses, and copies only allow-listed URL resources into `public/samples/<id>/`. Re-generated diffusion outputs can differ if the API model revision, seed behavior, preprocessing, or current code changes.

The raw per-job responses and prepared input PNGs are stored under ignored `screenshots/submission-samples/`. Those records contain local paths and transient API job IDs, so keep them out of public commits. The public manifest keeps model, prompt, seed, dimensions, and result metadata while removing those private/runtime identifiers.
