"""Copy frozen real assets and add local depth; never generate a new sky."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import sys
from unittest.mock import patch
os.environ['HF_HUB_OFFLINE'] = '1'
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import main
import depth_estimator

def rewrite(value, old, new):
    if isinstance(value, str):
        return value.replace(old + '/', new + '/')
    if isinstance(value, list):
        return [rewrite(item, old, new) for item in value]
    if isinstance(value, dict):
        return {key: rewrite(item, old, new) for key, item in value.items()}
    return value

manifest = json.loads((ROOT / 'screenshots/edge-repair/replay-manifest.json').read_text('utf8'))
output = []
for case in manifest['cases']:
    if case['name'] not in ('bigben', 'dog', 'paris'):
        continue
    name = case['name']
    target = ROOT / 'backend/data/depth-motion-fixtures' / name
    original = ROOT / case['assetDir']
    if not target.resolve().is_relative_to((ROOT / 'backend/data').resolve()):
        raise RuntimeError('Fixture target escaped project data')
    shutil.copytree(original, target, dirs_exist_ok=True)
    job_id = f'depth-motion-fixtures/{name}'
    old_prefix = case.get('mediaPrefix', f"/media/{case['jobId']}")
    new_prefix = f'/media/{job_id}'
    rewritten = rewrite(case, old_prefix, new_prefix)
    rewritten['jobId'] = job_id
    rewritten['job']['result']['id'] = job_id
    main.depth_jobs[job_id] = {'stage': 'estimating'}
    raw_path = ROOT / 'backend/data/d81c42515e92447b93fa4f0431d53eb7/subject-depth-f32.bin'
    inference = True
    if name == 'bigben':
        raw_source = raw_path.parent / 'source.webp'
        with Image.open(raw_source) as a, Image.open(target / 'source.webp') as b:
            if np.array_equal(np.asarray(a.convert('RGB')), np.asarray(b.convert('RGB'))):
                raw = np.fromfile(raw_path, dtype='<f4').reshape(b.height, b.width)
                inference = False
            else:
                print('Cached experimental Big Ben pixels differ; estimating this exact fixture locally.', flush=True)
    if not inference:
        with patch.object(depth_estimator, '_predict_raw', return_value=raw):
            result = main._process_depth(job_id)
    else:
        result = main._process_depth(job_id)
    rewritten['depth'] = {'status': 'complete', 'stage': 'complete', 'result': result}
    rewritten['assetDir'] = str(target)
    rewritten['photo'] = str(target / 'source.webp')
    rewritten['mediaPrefix'] = new_prefix
    rewritten['depthInferenceThisRun'] = inference
    rewritten['skyInferenceThisRun'] = False
    rewritten['files'] = {str(path.relative_to(target)).replace('\\', '/'): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in target.rglob('*') if path.is_file()}
    output.append(rewritten)
    print(json.dumps({'case': name, 'depthInference': inference, 'diagnostics': result['meshDepthDiagnostics']}, ensure_ascii=False), flush=True)
out = ROOT / 'screenshots/depth-motion-fix/manifest.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({'cases': output}, indent=2) + '\n', 'utf8')
print(str(out), flush=True)
