"""Measure left-to-right feature travel in three Big Ben regions.

The manually selected boxes are in 677x760 experiment stage screenshots.
Optical flow is a visual comparison, not a 3D accuracy metric.
"""

import json
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parents[1] / "screenshots" / "subject-depth-experiment"
REGIONS = {
    "front_clock": (340, 410, 480, 525),
    "left_clock": (185, 475, 240, 570),
    "middle_corner": (275, 395, 320, 580),
}
results = {}
for mode in ("flat", "depth"):
    left = cv2.imread(str(OUT / f"{mode}-left.png"), cv2.IMREAD_GRAYSCALE)
    right = cv2.imread(str(OUT / f"{mode}-right.png"), cv2.IMREAD_GRAYSCALE)
    if left is None or right is None or left.shape != right.shape:
        raise RuntimeError(f"Missing or mismatched {mode} browser screenshots")
    results[mode] = {}
    for name, (x1, y1, x2, y2) in REGIONS.items():
        roi = np.zeros_like(left)
        roi[y1:y2, x1:x2] = 255
        points = cv2.goodFeaturesToTrack(left, 500, 0.01, 5, mask=roi)
        if points is None:
            raise RuntimeError(f"No trackable points in {mode}/{name}")
        moved, valid, _ = cv2.calcOpticalFlowPyrLK(
            left, right, points, None, winSize=(31, 31), maxLevel=4
        )
        flow = (moved - points).reshape(-1, 2)[valid[:, 0] == 1]
        flow = flow[(flow[:, 0] > -90) & (flow[:, 0] < -10) & (np.abs(flow[:, 1]) < 15)]
        results[mode][name] = {
            "trackedPoints": int(len(flow)),
            "medianDxPx": round(float(np.median(flow[:, 0])), 2),
            "p10DxPx": round(float(np.percentile(flow[:, 0], 10)), 2),
            "p90DxPx": round(float(np.percentile(flow[:, 0], 90)), 2),
        }
(OUT / "motion-measurements.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results, indent=2))
