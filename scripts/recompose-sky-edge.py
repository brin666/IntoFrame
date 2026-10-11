"""Recompose real captured cases with exactly the frozen sky; never run diffusion."""
from pathlib import Path
import hashlib
import json
import shutil
import sys
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import main
from sky_detector import sky_mask_from_logits
from sky_refinement import refine_sky_boundary

OUT = ROOT / "screenshots" / "edge-repair"


def replace_urls(value, old_id, new_id):
    if isinstance(value, dict):
        return {key: replace_urls(item, old_id, new_id) for key,item in value.items()}
    if isinstance(value, list):
        return [replace_urls(item, old_id, new_id) for item in value]
    return value.replace(f"/media/{old_id}/",f"/media/{new_id}/") if isinstance(value,str) else value


def main_script():
    frozen = json.loads((OUT / "frozen-manifest.json").read_text())
    mixed = json.loads((OUT / "acceptance-frozen.json").read_text())
    definitions = [("bigben", OUT/"before", OUT/"semantic-recomputed.npz", frozen)]
    definitions += [(name, OUT/"acceptance-before"/name, OUT/"acceptance-before"/name/"semantic-recomputed.npz", record) for name,record in mixed.items()]
    cases, audits = [], []
    for name,before,raw,record in definitions:
        job_id = f"edge-repair-fixtures/after/{name}"
        target = main.DATA / job_id
        shutil.copytree(before,target,dirs_exist_ok=True)
        source=Image.open(before/"source.webp").convert("RGB")
        alpha=Image.open(before/"mask.png").convert("L")
        old_mask=Image.open(before/"editable-sky.png").convert("L")
        with np.load(raw) as prediction:
            logits=prediction["logits"]
        coarse,suitability=sky_mask_from_logits(logits,alpha)
        assert np.array_equal(np.asarray(coarse),np.asarray(old_mask)), "Pinned semantic rerun differs from failed mask"
        refined,metrics=refine_sky_boundary(source,alpha,coarse,logits)
        refined.save(target/"editable-sky.png")
        refined.save(OUT/f"{name}-editable-after.png")
        coarse.save(target/"editable-sky-coarse.png")
        np.savez_compressed(target/"sky-semantic.npz",logits=logits)
        styles={}
        for old_style in sorted((before/"styles").iterdir()):
            if not (old_style/"metadata.json").exists():
                continue
            old_metadata=json.loads((old_style/"metadata.json").read_text())
            style=old_style.name
            px,py=max(12,round(source.width*.06)),max(12,round(source.height*.06))
            sky=Image.open(old_style/"render-sky.webp").crop((px,py,px+source.width,py+source.height)).convert("RGB")
            main.restyle_jobs[(job_id,style)]={"stage":"compositing"}
            # Execute the actual production compositor with a cached real sky.
            with patch.object(main,"restyle",return_value=(sky,None,{**old_metadata["metrics"],"frozenSkyReplay":True,"generationVersion":frozen["head"]})):
                result=main._process_restyle(job_id,style)
            new_style=target/"styles"/style
            assert (new_style/"render-sky.webp").read_bytes()==(old_style/"render-sky.webp").read_bytes(), "Sky changed"
            subject=np.asarray(Image.open(new_style/"subject.png"))
            a=np.asarray(alpha)
            assert np.array_equal(subject[...,3],a), "Alpha changed"
            assert np.array_equal(subject[a==255,:3],np.asarray(source)[a==255]), "Opaque core changed"
            protected=(np.asarray(refined)==0)&(a==0)
            background=np.asarray(Image.open(new_style/"background.webp"))
            assert np.array_equal(background[protected],np.asarray(source)[protected]), "Non-sky scene changed"
            audits.append({"case":name,"style":style,"refinement":metrics,"sameSkySHA256":hashlib.sha256((new_style/"render-sky.webp").read_bytes()).hexdigest(),"alphaIdentical":True,"opaqueSubjectIdentical":True,"protectedVisiblePixels":int(protected.sum())})
            styles[style]={"status":"complete","stage":"complete","result":result}
            before_picture=Image.open(old_style/"composite.png").convert("RGB")
            after_picture=Image.open(new_style/"composite.png").convert("RGB")
            w=570;h=round(w*source.height/source.width)
            comparison=Image.new("RGB",(w*2,h+28),(24,24,24));draw=ImageDraw.Draw(comparison)
            for i,(label,pic) in enumerate([("BEFORE - same generated sky",before_picture),("AFTER - same generated sky",after_picture)]):
                comparison.paste(pic.resize((w,h)),(w*i,28));draw.text((w*i+8,7),label,fill="white")
            comparison.save(OUT/f"{name}-{style}-full.png")
            if name=="bigben":
                boxes=[(565,140,855,410),(755,470,1005,730),(330,770,415,1050)]
            elif name=="eiffel":
                boxes=[(400,860,650,1180),(350,1220,760,1420),(0,1410,source.width,source.height)]
            elif name=="paris":
                boxes=[(960,230,1110,550),(850,650,1150,830),(0,775,source.width,source.height)]
            else:
                boxes=[(260,420,750,850)]
            crops=Image.new("RGB",(1000,340*len(boxes)),(24,24,24));draw=ImageDraw.Draw(crops)
            for row,box in enumerate(boxes):
                for col,pic in enumerate([before_picture,after_picture]):
                    cut=pic.crop(box);cut.thumbnail((500,310));crops.paste(cut,(col*500,row*340+28))
                    draw.text((col*500+8,row*340+7),f'{"BEFORE" if col==0 else "AFTER"} crop {box}',fill="white")
            crops.save(OUT/f"{name}-{style}-details.png")
        original_id=record.get("jobId",record["job"]["result"]["id"])
        job=replace_urls(record["job"],original_id,job_id)
        job["result"]["id"]=job_id
        job["result"]["sky"]["boundaryRefinement"]=metrics
        # Freeze composition metadata/bounds: before and after must be identical.
        depth=replace_urls(record["depth"],original_id,job_id)
        depth["result"]["jobId"]=job_id
        cases.append({"name":name,"jobId":job_id,"job":job,"depth":depth,"styles":styles,"mediaPrefix":f"/media/{job_id}","selectedStyle":"cinematic-night","assetDir":str(target),"photo":str(before/"source.webp")})
    (OUT/"replay-manifest.json").write_text(json.dumps({"cases":cases},indent=2),encoding="utf8")
    (OUT/"repair-audit.json").write_text(json.dumps(audits,indent=2),encoding="utf8")
    print(json.dumps(audits,indent=2))


if __name__=="__main__":
    main_script()
