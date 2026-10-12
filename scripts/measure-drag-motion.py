"""Track local pixels in actual held, matched-camera screenshots; no inference."""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
output = root / 'screenshots/drag-motion-fix'
folder = output / 'final-desktop-composition/bigben-desktop'
record = json.loads((folder / 'results.json').read_text('utf8'))
left = cv2.imread(str(folder / 'after-matched-camera-left.png'), cv2.IMREAD_GRAYSCALE)
right = cv2.imread(str(folder / 'after-matched-camera-right.png'), cv2.IMREAD_GRAYSCALE)
if left is None or right is None or left.shape != right.shape:
    raise RuntimeError('Matched screenshots are missing or incompatible')
height, width = left.shape
pose = record['matchedCamera']['left']['pose']
shift_y = float(pose['photoShiftY'].removesuffix('%')) * height / 100
regions = {'front_clock': (340, 410, 480, 525), 'side_clock': (185, 475, 240, 570), 'corner': (275, 395, 320, 580)}
values = {}
for name, box in regions.items():
    x1, y1, x2, y2 = [round(v * s) for v, s in zip(box, (width / 677, height / 760, width / 677, height / 760))]
    y1 += round(shift_y); y2 += round(shift_y)
    mask = np.zeros_like(left); mask[y1:y2, x1:x2] = 255
    points = cv2.goodFeaturesToTrack(left, 300, 0.01, 4, mask=mask)
    moved, valid, _ = cv2.calcOpticalFlowPyrLK(left, right, points, None, winSize=(31, 31), maxLevel=4)
    flow = (moved - points).reshape(-1, 2)[valid[:, 0] == 1]
    flow = flow[(flow[:, 0] > -80) & (flow[:, 0] < -1) & (np.abs(flow[:, 1]) < 10)]
    if len(flow) < 10:
        raise RuntimeError(f'Insufficient tracked features: {name}')
    values[name] = {'trackedPoints': len(flow), 'medianDxPx': round(float(np.median(flow[:, 0])), 3), 'medianDyPx': round(float(np.median(flow[:, 1])), 3), 'roi': [x1, y1, x2, y2]}
dx = [v['medianDxPx'] for v in values.values()]
result = {'method': 'Lucas-Kanade tracking on actual screenshots reached by real drag; no camera state assignment or clock replacement', 'cameraLeft': record['matchedCamera']['left']['pose']['cameraX'], 'cameraRight': record['matchedCamera']['right']['pose']['cameraX'], 'cameraZ': 3.5, 'photoZoom': pose['photoZoom'], 'photoShiftY': pose['photoShiftY'], 'imageSize': [width, height], 'regions': values, 'regionMotionSpreadPx': round(max(dx) - min(dx), 3), 'limit': 'Nonuniform visible motion, not 3D geometry accuracy'}
(output / 'visible-motion-measurements.json').write_text(json.dumps(result, indent=2) + '\n', 'utf8')
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 22)
sheet = Image.new('RGB', (1030, 653), '#f1eee8'); draw = ImageDraw.Draw(sheet)
draw.text((20, 14), 'Actual horizontal drag; same photo and cached Night sky', font=font, fill='#171717')
for column, side in enumerate(('left', 'right')):
    image = Image.open(folder / f'after-matched-camera-{side}.png').convert('RGB')
    image.thumbnail((490, 550), Image.Resampling.LANCZOS)
    sheet.paste(image, (20 + column * 505, 49))
draw.text((20, 611), f'Clock/corner motion spread: {result["regionMotionSpreadPx"]}px. Shallow 2.5D relief.', font=font, fill='#171717')
sheet.save(output / 'drag-comparison.png')
print(json.dumps(result, indent=2))
