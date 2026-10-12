# Public demo samples

`public/samples/manifest.json` contains four real, precomputed IntoFrame API results: Big Ben, Taipei 101, the Flatiron Building, and Qutub Minar. Each image was uploaded, processed, depth-estimated, and restyled with Dreamy Pink, Golden Hour, and Cinematic Night. The outputs are API results, not hand-built fixtures or generated thumbnails.

Inputs are EXIF-oriented and reduced to a maximum side of 1024 pixels before PNG upload. The published `source.webp`, masks, subjects, backgrounds, render assets, and little-endian float32 subject-depth arrays are copied from the API URL resources. The thumbnail is a lossless WebP reduction of the real default-style composite. Runtime `/media/<job>/` URLs and identifiers are rewritten to `/samples/<id>/` and `sample:<id>`. Model weights, caches, raw job folders, and private job IDs stay out of the public bundle.

## Sources and visual limits

| ID | Source and credit | License | Prepared size | Visual review |
| --- | --- | --- | --- | --- |
| `tower` | [BigBenLondon.jpg](https://commons.wikimedia.org/wiki/File:BigBenLondon.jpg), Massimo Catarinella | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 683 × 1024 | The source crop cuts off the lower tower. The recognizable outline and three styles remain readable. This derivative retains the source credit and share-alike terms. |
| `taipei` | [Taipei 101 in blue sky](https://commons.wikimedia.org/wiki/File:Taipei_101_in_blue_sky.jpg), Pauloleong2002 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 614 × 1024 | Dreamy Pink and Cinematic Night retain a clear tower. Golden Hour has a visible repeated horizontal band across the upper sky; it remains available as a real inference result, but is not used for the film's three-style comparison. The source crop already touches the left and bottom frame edges. |
| `flatiron` | [The Flatiron Building (7).jpg](https://commons.wikimedia.org/wiki/File:The_Flatiron_Building_(7).jpg), PortableNYCTours | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 768 × 1024 | The central building has a readable outline. Neighboring buildings, trees, and people remain in the original foreground; small colored seams are visible around some distant roof and tree edges. This derivative retains the source credit and share-alike terms. |
| `qutub` | [Qutub Minar (54342718682).jpg](https://commons.wikimedia.org/wiki/File:Qutub_Minar_(54342718682).jpg), Joe deSousa (Mustang Joe) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 684 × 1024 | The tower remains clear in all three styles. A small airplane in the source sky has a colored cutout fringe, and the foreground ruins remain unchanged. |

The `tower`, `taipei`, and `flatiron` derivatives must retain their respective CC BY-SA terms. Qutub Minar is CC0; its author and source are still credited in the manifest and film. The private Big Ben upload used in earlier local tests is not included; the public tower sample comes from the cited Commons file.

Two candidates were excluded after real processing: the Portland Head Light photo failed the API's subject-mask validity check, and the Space Needle photo produced visible lattice cutout artifacts. The Space Needle outputs are retained only under ignored `screenshots/submission-samples/rejected/` for diagnosis; they are not referenced by the public manifest.

## Inference record

The samples were processed on 2026-10-12 against the running local API. Every published style has `atmosphereVersion: sky-scene-ambience-v2`. Restyle inference uses `stable-diffusion-v1-5/stable-diffusion-inpainting` revision `8a4288a76071f7280aedbdb3253bdb9e9d5d84bb`; depth uses `depth-anything/Depth-Anything-V2-Small-hf`; sky segmentation uses `nvidia/segformer-b0-finetuned-ade-512-512`. Seeds and API-reported restyle times are preserved in the public manifest. The preparation script pins hashes for both the accepted upload PNGs and source JPEGs, and stops before upload if either source does not match its expected hash.

| ID | Dreamy Pink seed / s | Golden Hour seed / s | Cinematic Night seed / s | Full API sequence / s | Published sample bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `tower` | 2596749283 / 4.46 | 1132834330 / 4.48 | 1053453892 / 4.58 | 25.59 | 10,067,725 |
| `taipei` | 4091872860 / 20.99 | 22493887 / 9.72 | 3900345956 / 7.54 | 56.17 | 14,515,645 |
| `flatiron` | 3636008079 / 3.76 | 2996006647 / 4.06 | 2615964726 / 4.69 | 27.61 | 21,145,652 |
| `qutub` | 3361121384 / 3.89 | 4064535891 / 4.19 | 2532276716 / 3.89 | 24.52 | 12,795,475 |

Full-sequence times include upload, depth, polling, three restyle requests, media copying, and thumbnail generation. The sum of the four recorded case times is 133.89 seconds; the cases were generated as separate API jobs. The four published directories contain 108 files and 58,524,497 bytes in total. The manifest SHA-256 is `c4656de7764ed6b8e5caea07df2e4996427ad28756c9213a450ba6404d1192ba`.

## Selected hashes

These hashes identify the prepared upload, source image, foreground mask, native float32 subject depth, and three real composites. `subject-depth-f32.bin` is the API byte stream and must contain `width × height × 4` bytes.

| ID | Prepared PNG | `source.webp` | `mask.png` | `subject-depth-f32.bin` |
| --- | --- | --- | --- | --- |
| `tower` | `43a634147142c69fa15223c3eab7c4bf19e4a232961d22b8f395e0894be3cf24` | `4bc996b9e44852591b75bfcd445f5ea1a7ccaa90efa08c2b6560198f8419fc53` | `2d1f438a1350c8e9c6a6d5d4a71ec1f2ea4dfba160860a243dfacf77068e7c25` | `11f778a39da171c4d35b493de4a120cacd8104cdc25b0502cc4b544b1896c3ad` |
| `taipei` | `11fec304ace508abde7f81ee524b9809c93c963da43a7d9ceec8965d6ee8eaad` | `9ca367ba7fb0c076194547a87463a00b0fd6ab3144b551f45eff952fcd627778` | `070e452a6f32ca475971a997223f0851bf43f9a635c2820622393085ceeb17d1` | `de4a1e9a992034105e25de779db3e7cc2799408d3143f94ddbab9c5eea0b5652` |
| `flatiron` | `c070fbf16df4ed6284533e6ec25ca9b53d1278221de57cc3a28d9ae9a4cd697e` | `df142f5e8d9917108eadefa1d3a2c378d23a971e5d7ed5bb7dcc595d8a2e3599` | `ec78c1662fb15d3734092c04c3101cb90433cf70aa5738f212281efba2727a2b` | `89dcc7961007a3404af54b51023e05bc370791745a80c0e6f3d73662a2e2c361` |
| `qutub` | `1543a09081263cb55441ce5d2b9e88ac259f930a82715b93b51c1861ff24d087` | `f475bfd4ea90dbae2e4e3b2bec1840fc5700c3e01a74bc7eb09a98e57dead5e7` | `97dcf0700f392e579612d9505c336def52caa4cfdc182953225c5016024987f6` | `7e8fa74c96f885ba72cff15c71f9170fbec75e4af7abe7a915370a20aadb1507` |

| ID | Dreamy Pink composite | Golden Hour composite | Cinematic Night composite |
| --- | --- | --- | --- |
| `tower` | `c28a878919953d834c3dede62a7f455e2bbbeb3cfe99739a664e5f3342a8a278` | `63a4572e938e0bbe56454978a874d982612ed367482f6b58814911e67ffd1e4d` | `e53e73d2eb8d5b0cdd2c07f7afb9ab0353d05193b6e8802a727884469541d6aa` |
| `taipei` | `0f129b7db2897cd2a165dcdb1baf934387ed0aeeddbf004d8e8701aed19f6590` | `80d938bb3cc26e83b191dc8494d17bc92a5e6da9cfa628ff19e9f57bf43387d1` | `bca4731aedddbdceafba4fadb8a2ea247402c8d339969afa63ba704970080c18` |
| `flatiron` | `d51ce9f51c51e2ba5e18cb1feb4d462e61355e52984de548a31350340e165f93` | `5d0faa9041143578171f3d6c56a6682b756ced3ecbd66bcc2725690f3b640446` | `7503ccde2129e4777815bd2b159c8b515b0b400308f1b86fb13a37a84192f4b1` |
| `qutub` | `358c729406e7ba10ca602b8841138b677feb05a78b69a2066244a0559d5d9fe3` | `89799aa56120f65be6a65c74730877ab3e932274d720558ce07c090d73352490` | `58441e3cd5781dad272765d89bf4c6a9ee4369c175239fcbe4c50efb2c9121be` |

## Rebuild and evidence

With Python 3.11 and the local API running on port 5190, regenerate the four cases in sequence:

```powershell
py -3.11 scripts\prepare-submission-samples.py --include tower,taipei,flatiron,qutub --replace
```

This performs a fresh upload, depth request, and three sequential restyle requests for each source. Existing prepared PNGs are preferred when present. If a prepared PNG is missing, the script reads or downloads the original to its separate `.jpg` path, verifies the raw JPEG hash, then applies EXIF orientation and the 1024-pixel limit before saving a PNG under ignored evidence. The recorded Qutub job used its pinned prepared PNG; rebuilding from the source JPEG produces a deterministic resized image with a small raster difference. API responses stay under ignored `screenshots/submission-samples/responses/`, and only allow-listed media resources are copied into `public/samples/<id>/`. To filter an existing manifest to the four verified architecture records without inference, run:

```powershell
py -3.11 scripts\prepare-submission-samples.py --prune-legacy
```

Prepared uploads and API response files are ignored because they contain local paths and transient job IDs. The public manifest keeps source credits, model, prompt, seed, dimensions, and result metadata while omitting those runtime IDs. Re-generated diffusion outputs can differ if the model revision, seed behavior, preprocessing, or current code changes.
