"""BiRefNet adapter. Only this module knows about model-specific tensors."""

from __future__ import annotations

from functools import lru_cache
from PIL import Image

MODEL_ID = "ZhengPeng7/BiRefNet"
MODEL_REVISION = "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"
INFERENCE_SIZE = 1024


@lru_cache(maxsize=1)
def _load_model():
    import torch
    from transformers import AutoModelForImageSegmentation

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. BiRefNet processing requires an NVIDIA GPU in this MVP.")
    # This is the model author's official Hugging Face repository. Loading it
    # executes repository Python code; do not switch to an unreviewed model ID.
    model = AutoModelForImageSegmentation.from_pretrained(
        MODEL_ID, revision=MODEL_REVISION, trust_remote_code=True
    )
    model = model.eval().to("cuda").half()
    return model


def segment(image: Image.Image) -> Image.Image:
    import torch
    from torchvision import transforms

    model = _load_model()
    transform = transforms.Compose([
        transforms.Resize((INFERENCE_SIZE, INFERENCE_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    tensor = transform(image).unsqueeze(0).to("cuda", dtype=torch.float16)
    with torch.inference_mode():
        prediction = model(tensor)[-1].sigmoid()[0, 0].float().cpu()
    mask = transforms.ToPILImage()(prediction).resize(image.size, Image.Resampling.LANCZOS)
    return mask
