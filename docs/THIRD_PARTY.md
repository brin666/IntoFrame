# Third-party code, models and tools

## Project code

No repository-wide license has been selected for IntoFrame-authored code. Public GitHub visibility does not imply MIT licensing. Existing history has not been rewritten or relicensed. A future project license decision must preserve the following separate third-party terms.

## Models used

| Model | Source | Pinned revision | Model terms |
| --- | --- | --- | --- |
| BiRefNet | [official weights](https://huggingface.co/ZhengPeng7/BiRefNet), [code](https://github.com/ZhengPeng7/BiRefNet) | `e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4` | MIT per model card and code. Official remote model Python is executed via `trust_remote_code=True`. |
| Depth Anything V2 **Small** | [official HF model](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf) | `5426e4f0f36572d16453bbda7a8389317b1bef99` | Apache 2.0. Do not apply Small's license to other checkpoint sizes. |
| Stable Diffusion v1.5 Inpainting | [model card and files](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting) | `8a4288a76071f7280aedbdb3253bdb9e9d5d84bb` | CreativeML OpenRAIL-M, including use restrictions. The checkpoint is an inpainting model; IntoFrame's current edit mask is all white to synthesize an underlay, then the original subject is composed separately. |
| SegFormer B0 ADE sky detector | [official model card](https://huggingface.co/nvidia/segformer-b0-finetuned-ade-512-512), [NVlabs license](https://github.com/NVlabs/SegFormer/blob/master/LICENSE) | `489d5cd81a0b59fab9b7ea758d3548ebe99677da` | NVIDIA Source Code License restricts use to noncommercial research/evaluation. Not MIT or Apache model weights; used locally for this prototype evaluation. Safetensors and built-in Transformers architecture; no remote Python execution. |

The diffusion input is a neutral field for sky texture synthesis. A **separate semantic editable-sky mask** controls source-image edits; an all-white diffusion texture mask does not authorize replacing the original scene. Non-sky or ambiguous photos are rejected. The three existing subject/depth/generation models are unchanged; this small CPU detector is an additional editing guard, with distinct licensing.

Weights are downloaded on first use through Hugging Face and cached outside the repository. They are not bundled or published in Git. No image-generation service API or paid subscription is configured. Relative depth is not physical distance; the experimental mesh is not a complete reconstructed building.

## Direct code dependencies

Checked against installed package metadata and bundled notices during local acceptance. Wheels may include components with their own notices; these labels are not a replacement for the complete bundled terms.

| Dependencies | License / notices |
| --- | --- |
| React, React DOM, Three.js, Vite, TypeScript, React/Three type declarations | MIT |
| Lucide React | ISC |
| Playwright | Apache 2.0 |
| FastAPI, einops | MIT |
| Pillow 12.3 | MIT-CMU |
| uvicorn, NumPy, SciPy | BSD-3-Clause; NumPy/SciPy bundled numerical components have additional notices. |
| scikit-image | BSD-3-Clause plus file-specific notices; sample image rights are separate. |
| PyTorch, torchvision | BSD-style; PyTorch metadata identifies BSD-3-Clause. Bundled CUDA components retain NVIDIA terms. |
| python-multipart, OpenCV, transformers, accelerate, timm, Kornia, huggingface-hub, Diffusers | Apache 2.0; OpenCV wheels also contain third-party components. |

Exact JS versions are in [package-lock.json](../package-lock.json); Python runtime dependencies are in [requirements.txt](../backend/requirements.txt). PyTorch/torchvision CUDA wheel installation is documented separately in the [README](../README.md).

AI coding assistance: OpenAI Codex was used for implementation, debugging, test execution and documentation. AI background generation, conventional image processing, and browser rendering are distinct stages. Sample rights and credits are listed in [ASSET_CREDITS.md](ASSET_CREDITS.md).
