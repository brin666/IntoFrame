// Live local saved-job regression. GET/API and all image/depth bytes come from
// the running server. POST acknowledgements only select an already complete job;
// no upload, segmentation, depth or style inference is started by this script.
// node scripts/style-adaptation-browser.mjs --base http://127.0.0.1:5190
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";

function arg(name,fallback) { const i=process.argv.indexOf(`--${name}`); if(i<0)return fallback; const value=process.argv[i+1]; assert(value&&!value.startsWith("--")); return value; }
if(process.argv.includes("--help")) { console.log("Usage: node scripts/style-adaptation-browser.mjs [--base URL] [--job ID] [--version VERSION] [--out DIR] [--desktop-only | --mobile-only]"); process.exit(0); }
const base=arg("base","http://127.0.0.1:5190").replace(/\/$/,""),origin=new URL(base).origin;
const jobId=arg("job","a2bc9adae2b64a3bac527fb496439eb2"),version=arg("version","sky-scene-ambience-v2");
assert(/^[a-z0-9_-]+$/i.test(jobId),"Safe saved job ID required");
const workspace=resolve("."),mediaRoot=resolve("backend/data"),outRoot=resolve(arg("out","screenshots/style-adaptation/browser"));
const photo=resolve(mediaRoot,jobId,"source.webp"),styles=["dreamy-pink","cinematic-night"];
const labels={"dreamy-pink":"Dreamy Pink","cinematic-night":"Cinematic Night"};
assert(existsSync(photo),"Existing original source.webp is required");
assert(!(process.argv.includes("--desktop-only")&&process.argv.includes("--mobile-only")),"Choose one device filter");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),fileHash=path=>sha(readFileSync(path));
const localPath=path=>relative(workspace,path).replaceAll("\\","/");
function inside(path,root) { const rel=relative(root,path);return rel===""||(!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(`..${sep}`)); }
mkdirSync(outRoot,{recursive:true});
const sourceFiles=["src/App.tsx","src/api.ts","src/PhotoRevealPlayer.tsx","src/remotion/PhotoReveal.tsx","src/remotion/revealTimeline.ts","src/SpatialFrameScene.tsx","src/sceneMotion.ts","src/exportFrame.ts","src/styles.css","src/experiment/ExperimentApp.tsx","backend/atmosphere.py","backend/main.py","backend/restyler.py","scripts/style-adaptation-browser.mjs"];
const sourceSHA256=Object.fromEntries(sourceFiles.filter(existsSync).map(path=>[path,fileHash(path)]));
async function liveJson(path) { const response=await fetch(new URL(path,base));assert(response.ok,`${path}: HTTP${response.status}`);return response.json(); }
const api={job:await liveJson(`/api/jobs/${jobId}`),depth:await liveJson(`/api/depth/${jobId}`),styles:{}};
assert(api.job.status==="complete"&&api.job.result&&api.depth.status==="complete"&&api.depth.result,"Preflight requires existing completed segmentation and depth; this script cannot start inference");
for(const style of styles) {
  api.styles[style]=await liveJson(`/api/restyle/${jobId}/${style}`);
  const job=api.styles[style],prefix=`/media/${jobId}/styles/${style}/${version}/`;
  assert(job.status==="complete"&&job.result?.atmosphereVersion===version,`${style}: root must prepare a complete current atmosphere result first`);
  for(const key of ["backgroundUrl","renderBackgroundUrl","subjectUrl","renderSkyUrl","renderSceneUrl","compositeUrl"])assert(job.result[key]?.startsWith(prefix),`${style}: ${key} must use versioned assets`);
}
const assetHashes={};
function urls(value,found=new Set()) { if(typeof value==="string"&&value.startsWith("/media/"))found.add(value);else if(Array.isArray(value))value.forEach(item=>urls(item,found));else if(value&&typeof value==="object")Object.values(value).forEach(item=>urls(item,found));return found; }
for(const url of urls(api)) {
  const path=resolve(mediaRoot,decodeURIComponent(url.slice(7)));assert(inside(path,mediaRoot)&&existsSync(path),`Missing/unsafe local asset ${url}`);
  const response=await fetch(new URL(url,base));assert(response.ok,`${url}: HTTP${response.status}`);
  const digest=sha(Buffer.from(await response.arrayBuffer()));assert.equal(digest,fileHash(path),`${url}: HTTP media does not match local saved bytes`);
  assetHashes[url]=digest;
}
writeFileSync(join(outRoot,"live-api-and-assets.json"),JSON.stringify({base,jobId,version,api,assetHashes,sourceSHA256,sourcePhotoSHA256:fileHash(photo),mode:"live-local-saved-job-reuse",newInference:false},null,2));

function observe() {
  const evidence={samples:[],events:[]};
  setInterval(()=>{ const stage=document.querySelector(".photo-stage"),comp=stage?.querySelector('[data-photo-reveal="composition"]');if(stage)evidence.samples.push({time:performance.now(),reveal:stage.dataset.reveal,frame:comp?Number(comp.dataset.revealFrame):null,mode:stage.dataset.motionMode,cameraX:Number(stage.dataset.cameraX),cameraTargetX:Number(stage.dataset.cameraTargetX),interactive:stage.classList.contains("spatial-ready")}); },25);
  for(const type of ["pointerdown","pointermove","pointerup","pointercancel"])document.addEventListener(type,event=>{const stage=document.querySelector(".photo-stage");if(stage&&(event.target===stage||stage.contains(event.target)))evidence.events.push({type,pointerType:event.pointerType,trusted:event.isTrusted,time:performance.now()});},true);
  window.__styleEvidence=evidence;
}
async function geometry(page) {
  return page.locator(".photo-stage").evaluate(stage=>{
    const comp=stage.querySelector('[data-photo-reveal="composition"]'),player=stage.querySelector('[data-photo-reveal="player"]'),rect=stage.getBoundingClientRect();
    return {data:{...stage.dataset},cameraX:Number(stage.dataset.cameraX),cameraTargetX:Number(stage.dataset.cameraTargetX),mode:stage.dataset.motionMode,interactive:stage.classList.contains("spatial-ready"),
      zoom:Number(stage.style.getPropertyValue("--photo-zoom")),shiftX:parseFloat(stage.style.getPropertyValue("--photo-x"))/100,shiftY:parseFloat(stage.style.getPropertyValue("--photo-y"))/100,
      width:rect.width,height:rect.height,composition:comp?{...comp.dataset}:null,player:player?{...player.dataset}:null,
      subjectUrl:stage.querySelector(".subject-layer img")?.getAttribute("src"),backgroundUrl:stage.querySelector(".background-content > img")?.getAttribute("src"),
      images:[...stage.querySelectorAll('[data-reveal-layer="source"],[data-reveal-layer="background"],[data-reveal-layer="subject"]')].map(image=>({layer:image.dataset.revealLayer,src:image.getAttribute("src"),left:parseFloat(image.style.left),top:parseFloat(image.style.top),width:parseFloat(image.style.width),height:parseFloat(image.style.height)})),
      host:{...stage.querySelector(".spatial-canvas")?.dataset},canvases:[...stage.querySelectorAll("canvas")].map(canvas=>({width:canvas.width,height:canvas.height,visibility:canvas.style.visibility,data:{...canvas.dataset}}))};
  });
}
async function ready(page,style=null) {
  const subject=style?api.styles[style].result.subjectUrl:api.job.result.subjectUrl,background=style?api.styles[style].result.renderBackgroundUrl:api.depth.result.backgroundUrl;
  await page.getByText("YOUR FRAME IS READY",{exact:true}).waitFor({timeout:30000});
  await page.waitForFunction(expected=>{const stage=document.querySelector(".photo-stage"),canvas=stage?.querySelector(".spatial-canvas canvas");return stage?.querySelector(".subject-layer img")?.getAttribute("src")===expected.subject&&stage?.querySelector(".background-content > img")?.getAttribute("src")===expected.background&&stage.dataset.subjectGeometry==="depth-mesh"&&canvas?.style.visibility==="visible"&&canvas.dataset.backgroundUrl===expected.background;},{subject,background},{timeout:30000});
}
async function active(page) { await page.waitForFunction(()=>document.querySelector(".photo-stage")?.dataset.reveal==="active"&&document.querySelector('[data-photo-reveal="composition"]'),null,{timeout:20000}); }
async function idle(page) { await page.waitForFunction(()=>document.querySelector(".photo-stage")?.dataset.reveal==="idle"&&!document.querySelector('[data-photo-reveal="player"]'),null,{timeout:12000}); }
async function frame(page,value) { await page.waitForFunction(want=>Number(document.querySelector('[data-photo-reveal="composition"]')?.dataset.revealFrame)>=want,value,{timeout:10000}); }
async function pixels(page,shot,expected) {
  return page.evaluate(async({shot,expected})=>{
    const load=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;});
    const [actual,image]=await Promise.all([load(shot),load(expected)]),canvas=document.createElement("canvas");canvas.width=actual.naturalWidth;canvas.height=actual.naturalHeight;const context=canvas.getContext("2d",{willReadFrequently:true});
    const points=[[.08,.04],[.92,.04],[.5,.07],[.08,.2],[.24,.3],[.74,.3],[.92,.2],[.08,.5],[.5,.5],[.92,.5],[.22,.72],[.76,.72],[.08,.84],[.92,.84],[.08,.96],[.5,.96],[.92,.96]];
    function sample(value){context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(value,0,0,canvas.width,canvas.height);return points.map(([x,y])=>[...context.getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data]);}
    const got=sample(actual),want=sample(image),samples=got.map((rgba,i)=>({point:points[i],actual:rgba,expected:want[i],difference:Math.max(...rgba.slice(0,3).map((v,c)=>Math.abs(v-want[i][c])))}));const diffs=samples.map(v=>v.difference).sort((a,b)=>a-b);
    return {samples,medianDifference:diffs[Math.floor(diffs.length/2)],maximumDifference:diffs.at(-1),within22:diffs.filter(v=>v<=22).length,nativeExpected:{width:image.naturalWidth,height:image.naturalHeight},method:"17 samples of the visible stage and native exported PNG scaled to the same visible size; not whole screenshot byte identity."};
  },{shot:`data:image/png;base64,${readFileSync(shot).toString("base64")}`,expected});
}
async function compareBeforePixels(page,first,second) {
  return page.evaluate(async({first,second})=>{
    const load=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;});
    const [a,b]=await Promise.all([load(first),load(second)]),sameSize=a.naturalWidth===b.naturalWidth&&a.naturalHeight===b.naturalHeight;
    if(!sameSize)return {sameSize:false};
    const canvas=document.createElement("canvas");canvas.width=a.naturalWidth;canvas.height=a.naturalHeight;const context=canvas.getContext("2d",{willReadFrequently:true});
    context.drawImage(a,0,0);const left=context.getImageData(0,0,canvas.width,canvas.height).data;context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(b,0,0);const right=context.getImageData(0,0,canvas.width,canvas.height).data;
    let maximumChannelDifference=0,totalDifference=0,changedPixels=0,pixelsOver2=0;
    for(let i=0;i<left.length;i+=4){let maximumPixelDifference=0;for(let channel=0;channel<3;channel++){const difference=Math.abs(left[i+channel]-right[i+channel]);maximumChannelDifference=Math.max(maximumChannelDifference,difference);maximumPixelDifference=Math.max(maximumPixelDifference,difference);totalDifference+=difference;}if(maximumPixelDifference>0)changedPixels++;if(maximumPixelDifference>2)pixelsOver2++;}
    return {sameSize,width:canvas.width,height:canvas.height,maximumChannelDifference,meanChannelDifference:totalDifference/(canvas.width*canvas.height*3),changedPixels,pixelsOver2,method:"Full decoded RGB comparison at unchanged camera/crop. Up to two channel units allow browser GPU rounding; original asset bytes are checked separately."};
  },{first:`data:image/png;base64,${readFileSync(first).toString("base64")}`,second:`data:image/png;base64,${readFileSync(second).toString("base64")}`});
}
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--enable-webgl"]}),records=[];
try {
  const devices=process.argv.includes("--desktop-only")?[false]:process.argv.includes("--mobile-only")?[true]:[false,true];
  for(const mobile of devices) {
    const device=mobile?"mobile":"desktop",out=join(outRoot,device);mkdirSync(out,{recursive:true});
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1050},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,acceptDownloads:true});await context.addInitScript(observe);
    const page=await context.newPage(),touch=mobile?await context.newCDPSession(page):null;
    const checks=[],errors=[],consoleErrors=[],httpErrors=[],requests=[],mediaRequests=[],servedSourceSHA256={},captures=[];
    const check=(name,passed,evidence)=>checks.push({name,passed:Boolean(passed),...(evidence===undefined?{}:{evidence})});
    const record={device,base,jobId,version,mode:"live-local-saved-job-reuse",newInference:false,physicalPhoneTest:false,videoRecordings:false,api,assetHashes,sourceSHA256,servedSourceSHA256,checks,errors,consoleErrors,httpErrors,requests,mediaRequests,captures,styles:{}};
    context.on("page",opened=>{
      opened.on("pageerror",error=>errors.push(error.message));opened.on("console",message=>{if(message.type()==="error")consoleErrors.push(message.text());});
      opened.on("response",async response=>{const path=new URL(response.url()).pathname;if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});if(/\.(?:js|css)(?:\?|$)/.test(response.url()))try{servedSourceSHA256[path]=sha(await response.body());}catch{}if(path.startsWith("/media/"))try{mediaRequests.push({path,status:response.status(),sha256:sha(await response.body())});}catch{} });
    });
    // The first page was created before this context listener; attach the same readers.
    page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")consoleErrors.push(message.text());});
    page.on("response",async response=>{const path=new URL(response.url()).pathname;if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});if(/\.(?:js|css)(?:\?|$)/.test(response.url()))try{servedSourceSHA256[path]=sha(await response.body());}catch{}if(path.startsWith("/media/"))try{mediaRequests.push({path,status:response.status(),sha256:sha(await response.body())});}catch{} });
    await context.route("**/*",async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname;
      if(url.origin!==origin){await route.fulfill({status:200,contentType:url.hostname==="fonts.googleapis.com"||path.endsWith(".css")?"text/css":"application/octet-stream",body:""});return;}
      if(path.startsWith("/api/")) {
        requests.push({path,method:request.method(),time:Date.now(),acknowledgementOnly:request.method()!=="GET"});
        if(request.method()==="GET"){await route.continue();return;}
        let ack;
        if(path==="/api/jobs")ack={id:jobId};
        else if(path==="/api/depth"&&request.postDataJSON().jobId===jobId)ack={id:jobId,status:"complete"};
        else if(path==="/api/restyle"){const body=request.postDataJSON();if(body.jobId===jobId&&api.styles[body.style])ack={id:jobId,style:body.style,status:"complete"};}
        assert(ack,`Unprepared inference-producing API request blocked: ${path}`);await route.fulfill({status:202,contentType:"application/json",body:JSON.stringify(ack)});return;
      }
      await route.continue();
    });
    async function capture(name) { await page.locator(".photo-stage").scrollIntoViewIfNeeded();const before=await geometry(page),path=join(out,`${name}.png`),clip=await page.locator(".photo-stage").boundingBox();assert(clip);await page.screenshot({path,clip});const after=await geometry(page);captures.push({name,file:localPath(path),sha256:fileHash(path),before,after});return {path,before,after}; }
    async function download(name) { const pending=page.waitForEvent("download");await page.getByRole("button",{name:"Download PNG",exact:true}).evaluate(button=>button.click());const path=join(out,`${name}.png`);await(await pending).saveAs(path);return {path,sha256:fileHash(path),dataUrl:`data:image/png;base64,${readFileSync(path).toString("base64")}`}; }
    async function pressMove() {await page.locator(".photo-stage").scrollIntoViewIfNeeded();const box=await page.locator(".photo-stage").boundingBox();assert(box);const start={x:box.x+box.width*.5,y:box.y+box.height*.5},end={x:start.x+box.width*.16,y:start.y};if(touch){await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[start]});for(let i=1;i<=6;i++){await touch.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:start.x+(end.x-start.x)*i/6,y:start.y}]});await page.waitForTimeout(20);}}else{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});}await page.waitForTimeout(400);return geometry(page);}
    async function release() {if(touch)await touch.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});else await page.mouse.up();}
    async function replay() {await page.getByRole("button",{name:"Replay transition",exact:true}).evaluate(button=>button.click());await active(page);}
    try {
      await page.goto(base,{waitUntil:"domcontentloaded",timeout:30000});await page.locator("input[type=file]").setInputFiles(photo);await ready(page);
      record.original=await capture("00-original-live-depth-preview");
      for(const style of mobile?["cinematic-night"]:styles) {
        const result=api.styles[style].result,state={result};record.styles[style]=state;
        await page.getByRole("button",{name:labels[style],exact:false}).click();
        await page.getByRole("button",{name:"Generate background",exact:true}).evaluate(button=>button.click());const started=Date.now();await active(page);
        state.original=await capture(`${style}-01-reveal-original`);
        check(`${style}: current generated atmosphere auto-plays from original`,state.original.before.player?.revealSource===api.job.result.sourceUrl&&state.original.before.player?.revealBackground===result.backgroundUrl&&state.original.before.player?.revealSubject===result.subjectUrl&&Number(state.original.before.composition?.revealStyleProgress)===0,state.original);
        const apiDuring=requests.length;await frame(page,45);state.exportDuring=await download(`${style}-export-during`);delete state.exportDuring.dataUrl;
        await frame(page,112);state.popout=await capture(`${style}-02-popout`);
        const heldDuring=await pressMove();await release();check(`${style}: native interaction is suspended during reveal`,heldDuring.data.reveal==="active"&&!heldDuring.interactive&&Math.abs(heldDuring.cameraX)<.0001,heldDuring);
        await frame(page,146);state.final=await capture(`${style}-03-final-hold`);
        const final=state.final.before,pose=final.composition;check(`${style}: native final composition uses centered crop and 13 percent bars`,Number(pose?.revealBarFraction)===.13&&Number(pose?.revealStyleProgress)===1&&Number(pose?.revealZoom)===final.zoom&&Number(pose?.revealShiftX)===final.shiftX&&Number(pose?.revealShiftY)===final.shiftY&&final.images.every(image=>Math.abs(image.left-api.job.result.width*((1-final.zoom)/2+final.shiftX))<.0001&&Math.abs(image.top-api.job.result.height*((1-final.zoom)/2+final.shiftY))<.0001),final);
        await idle(page);state.durationMilliseconds=Date.now()-started;await ready(page,style);state.preview=await capture(`${style}-04-real-preview`);
        check(`${style}: live Three scene uses current sky/scene/subject version`,state.preview.before.data.subjectGeometry==="depth-mesh"&&state.preview.before.host.backgroundMode==="sky-layers"&&state.preview.before.subjectUrl===result.subjectUrl&&state.preview.before.backgroundUrl===result.renderBackgroundUrl&&state.preview.before.canvases.some(canvas=>canvas.data.skyUrl===result.renderSkyUrl&&canvas.data.sceneUrl===result.renderSceneUrl),state.preview);
        check(`${style}: six second reveal completes into autonomous scene`,state.durationMilliseconds>=5700&&state.durationMilliseconds<=10000&&state.preview.before.mode==="autonomous",state.durationMilliseconds);
        state.exportStatic=await download(`${style}-export-static`);state.finalPixels=await pixels(page,state.final.path,state.exportStatic.dataUrl);delete state.exportStatic.dataUrl;
        check(`${style}: visible final pose agrees with native PNG`,state.finalPixels.nativeExpected.width===api.job.result.width&&state.finalPixels.nativeExpected.height===api.job.result.height&&state.finalPixels.medianDifference<=12&&state.finalPixels.within22>=15,state.finalPixels);
        state.held=await pressMove();state.exportHeld=await download(`${style}-export-held`);delete state.exportHeld.dataUrl;await release();await page.waitForFunction(()=>document.querySelector(".photo-stage")?.dataset.motionMode==="autonomous",null,{timeout:5000});state.returned=await capture(`${style}-05-drag-returned`);
        check(`${style}: native hold/drag and release remain responsive`,state.held.mode==="drag"&&state.held.interactive&&Math.abs(state.held.cameraX)>.0005&&state.returned.before.mode==="autonomous",{held:state.held,returned:state.returned});
        check(`${style}: PNG is identical during reveal, static preview and held camera`,state.exportDuring.sha256===state.exportStatic.sha256&&state.exportHeld.sha256===state.exportStatic.sha256,{during:state.exportDuring.sha256,static:state.exportStatic.sha256,held:state.exportHeld.sha256});
        await replay();await frame(page,35);await page.getByRole("button",{name:"View before",exact:true}).evaluate(button=>button.click());await idle(page);await ready(page);await page.waitForTimeout(6400);state.before=await capture(`${style}-06-before-original`);
        check(`${style}: Before stays original after cancelling reveal`,state.before.before.subjectUrl===api.job.result.subjectUrl&&state.before.before.backgroundUrl===api.depth.result.backgroundUrl&&!state.before.before.interactive&&Math.abs(state.before.before.cameraX)<.0001&&!state.before.before.player&&await page.getByRole("button",{name:"Download PNG",exact:true}).isDisabled(),state.before);
        await page.getByRole("button",{name:"View after",exact:true}).click();await ready(page,style);await replay();state.replay=await capture(`${style}-07-replay-original`);
        check(`${style}: Replay restarts the original photograph`,Number(state.replay.before.composition?.revealFrame)<24&&Number(state.replay.before.composition?.revealStyleProgress)===0,state.replay);
        await page.getByRole("button",{name:"Skip animation",exact:true}).evaluate(button=>button.click());await idle(page);await ready(page,style);
        check(`${style}: replay/cancel/drag/export created no API job`,requests.length===apiDuring,requests.slice(apiDuring));
      }
      if(!mobile) {
        const pink=record.styles["dreamy-pink"].before.path,night=record.styles["cinematic-night"].before.path;record.beforePixelComparison=await compareBeforePixels(page,pink,night);check("Before preserves original pixels within GPU rounding across atmospheres",record.beforePixelComparison.sameSize&&record.beforePixelComparison.maximumChannelDifference<=2&&record.beforePixelComparison.meanChannelDifference<=.01,record.beforePixelComparison);
        const experiment=await context.newPage();await experiment.goto(`${base}/experiment.html?job=${jobId}`,{waitUntil:"domcontentloaded",timeout:30000});await experiment.getByRole("status").getByText(/Ready/).waitFor({timeout:30000});
        await experiment.locator('button[data-mode="depth"]').click();await experiment.locator('[data-view="left"]').click();await experiment.waitForTimeout(1200);const left=Number(await experiment.locator(".experiment-stage").getAttribute("data-camera-x"));await experiment.locator('[data-view="center"]').click();await experiment.waitForTimeout(1400);const center=Number(await experiment.locator(".experiment-stage").getAttribute("data-camera-x"));
        const path=join(out,"experiment-original-depth-center.png");await experiment.locator(".experiment-stage").screenshot({path});record.experiment={url:experiment.url(),left,center,metrics:await experiment.locator(".experiment-metrics").innerText(),screenshot:localPath(path),canvas:await experiment.locator(".experiment-stage canvas").evaluate(canvas=>({width:canvas.width,height:canvas.height}))};
        check("Isolated experiment entry retains original depth mesh and camera controls",left<-.02&&Math.abs(center)<.001&&record.experiment.canvas.width>0&&record.experiment.metrics.includes("triangles"),record.experiment);await experiment.close();
      }
      record.events=await page.evaluate(()=>window.__styleEvidence.events);record.observedFrames=await page.evaluate(()=>window.__styleEvidence.samples);
      check("Native input is trusted",record.events.some(event=>event.type==="pointerdown"&&event.trusted&&event.pointerType===(mobile?"touch":"mouse")),record.events.filter(event=>event.type==="pointerdown"));
      const originalUrls=[api.job.result.sourceUrl,api.job.result.maskUrl,api.job.result.subjectUrl,api.depth.result.backgroundUrl,api.depth.result.meshDepthUrl].filter(Boolean),afterHashes={};for(const url of originalUrls){const response=await fetch(new URL(url,base));assert(response.ok);afterHashes[url]=sha(Buffer.from(await response.arrayBuffer()));}check("Original source/mask/subject/depth bytes remain unchanged",originalUrls.every(url=>assetHashes[url]===afterHashes[url]),afterHashes);
      check("Live media bytes match saved actual assets",mediaRequests.every(request=>!assetHashes[request.path]||assetHashes[request.path]===request.sha256),mediaRequests);
      record.overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);check("No horizontal overflow",record.overflow<=1,record.overflow);check("No JavaScript errors",errors.length===0,errors);check("No console errors",consoleErrors.length===0,consoleErrors);check("No HTTP errors",httpErrors.length===0,httpErrors);record.completed=true;
    } catch(error) {record.completed=false;record.failure=error.stack||error.message;check("Scenario completed",false,error.message);record.failureBody=await page.locator("body").innerText().catch(()=>"");record.failureGeometry=await geometry(page).catch(()=>null);await page.screenshot({path:join(out,"failure.png"),fullPage:true}).catch(()=>{});}
    finally {record.passed=record.completed&&checks.every(value=>value.passed);await context.close();writeFileSync(join(out,"results.json"),JSON.stringify(record,null,2));records.push(record);writeFileSync(join(outRoot,"results.json"),JSON.stringify(records,null,2));console.log(JSON.stringify({device,passed:record.passed,checks:checks.length,failures:checks.filter(check=>!check.passed).map(check=>check.name),failure:record.failure,out:localPath(out)}));}
  }
} finally {await browser.close();}
const summary={base,jobId,version,mode:"live-local-saved-job-reuse",newInference:false,physicalPhoneTest:false,videoRecordings:false,passed:records.every(record=>record.passed),checkTotal:records.reduce((sum,record)=>sum+record.checks.length,0),cases:records.map(record=>({device:record.device,passed:record.passed,checks:record.checks.length,failures:record.checks.filter(check=>!check.passed).map(check=>check.name)})),completedAt:new Date().toISOString()};writeFileSync(join(outRoot,"summary.json"),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));if(!summary.passed)process.exitCode=1;
