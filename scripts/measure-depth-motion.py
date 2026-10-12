"""Measure visible local feature travel in matched-camera browser screenshots."""
from pathlib import Path
import json
import cv2
import numpy as np
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'screenshots/depth-motion-fix'
regions = {'front_clock': (340,410,480,525), 'side_clock': (185,475,240,570), 'corner': (275,395,320,580)}
result = {'method':'Lucas-Kanade feature tracking on actual screenshots; not a 3D accuracy metric', 'regionsReferenceSize':[677,760], 'modes':{}}
for label, folder in [('baseline', 'baseline-browser/bigben-desktop'), ('local_depth', 'after-final/bigben-desktop')]:
    path=OUT/folder
    left=cv2.imread(str(path/'after-camera-left.png'),cv2.IMREAD_GRAYSCALE)
    right=cv2.imread(str(path/'after-camera-right.png'),cv2.IMREAD_GRAYSCALE)
    if left is None or right is None or left.shape != right.shape:
        raise RuntimeError('Matched camera images are missing or have different dimensions')
    record=json.loads((path/'results.json').read_text('utf8'))
    height,width=left.shape
    rest=record['after']['rest']
    shift_y=float(rest['shiftY'].removesuffix('%'))/100*height
    values={}
    for name,(x1,y1,x2,y2) in regions.items():
        box=tuple(round(value*scale) for value,scale in zip((x1,y1,x2,y2),(width/677,height/760,width/677,height/760)))
        bx1,by1,bx2,by2=box
        by1+=round(shift_y);by2+=round(shift_y)
        roi=np.zeros_like(left);roi[by1:by2,bx1:bx2]=255
        points=cv2.goodFeaturesToTrack(left,300,0.01,4,mask=roi)
        if points is None: raise RuntimeError(f'No trackable pixels in {label}/{name}')
        moved,valid,_=cv2.calcOpticalFlowPyrLK(left,right,points,None,winSize=(31,31),maxLevel=4)
        flow=(moved-points).reshape(-1,2)[valid[:,0]==1]
        flow=flow[(flow[:,0]>-80)&(flow[:,0]<-1)&(np.abs(flow[:,1])<10)]
        if len(flow)<10: raise RuntimeError(f'Insufficient feature matches in {label}/{name}')
        values[name]={'trackedPoints':len(flow),'medianDxPx':round(float(np.median(flow[:,0])),3),'medianDyPx':round(float(np.median(flow[:,1])),3),'roi':[bx1,by1,bx2,by2]}
    dx=[item['medianDxPx'] for item in values.values()]
    result['modes'][label]={'regions':values,'regionMotionSpreadPx':round(max(dx)-min(dx),3),'imageSize':[width,height]}
(OUT/'visible-motion-measurements.json').write_text(json.dumps(result,indent=2)+'\n','utf8')
print(json.dumps(result,indent=2),flush=True)
