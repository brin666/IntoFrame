"""Create reproducible A/B contact sheets from the browser screenshots."""

from pathlib import Path

import matplotlib.pyplot as plt
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "screenshots" / "subject-depth-experiment"

for detail in (False, True):
    figure, axes = plt.subplots(2, 3, figsize=(15, 11 if not detail else 7.5), dpi=140)
    figure.patch.set_facecolor("#151719")
    for row, mode in enumerate(("flat", "depth")):
        for col, view in enumerate(("left", "center", "right")):
            image = Image.open(OUT / f"{mode}-{view}.png")
            if detail:
                image = image.crop((130, 320, 545, 610))
            axes[row, col].imshow(image)
            axes[row, col].set_title(f"{mode.upper()} / {view.upper()}", color="white", fontsize=12)
            axes[row, col].axis("off")
    figure.tight_layout(pad=1.5)
    figure.savefig(OUT / ("clock-detail-comparison.png" if detail else "six-view-comparison.png"),
                   facecolor=figure.get_facecolor())
    plt.close(figure)
