import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const base = process.env.INTOFRAME_URL || "http://127.0.0.1:5190";
const out = resolve("screenshots/submission-browser");
mkdirSync(out,{recursive:true});
const manifest = JSON.parse(readFileSync(resolve("public/samples/manifest.json"),"utf8"));
const browser = await chromium.launch({headless:true,executablePath:process.env.REMOTION_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe"});
const checks = [];
let completed = false;
let failure = null;
function check(name,passed,evidence) { checks.push({name,passed,evidence});assert(passed,name); }
try {
  const page = await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true});
  const api=[],errors=[];
  page.on("request",r=>{if(new URL(r.url()).pathname.startsWith("/api/"))api.push(r.url());});
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base,{waitUntil:"networkidle"});
  await page.locator(".sample-card").last().waitFor();
  check("Gallery contains the accepted building examples",await page.locator(".sample-card").count()===manifest.samples.length && manifest.samples.every(s=>s.category==="architecture"));
  await page.screenshot({path:resolve(out,"gallery.png"),fullPage:true});
  for(const sample of manifest.samples) {
    await page.goto(`${base}/?sample=${sample.id}`,{waitUntil:"networkidle"});
    const stage=page.locator(".photo-stage.spatial-ready");await stage.waitFor({timeout:30000});
    check(`${sample.id}: native depth mesh ready`,await stage.getAttribute("data-subject-geometry")==="depth-mesh");
    const originalSrc=sample.result.subjectUrl;
    await page.getByRole("button",{name:"View before",exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector(".photo-stage")?.classList.contains("spatial-ready"));
    check(`${sample.id}: Before uses original subject`,await page.locator(".subject-layer img").getAttribute("src")===originalSrc);
    await page.getByRole("button",{name:"View after",exact:true}).click();await stage.waitFor();
    for(const style of ["dreamy-pink","golden-hour","cinematic-night"]) {
      const labels={"dreamy-pink":"Dreamy Pink","golden-hour":"Golden Hour","cinematic-night":"Cinematic Night"};
      await page.getByRole("button",{name:new RegExp(labels[style])}).click();
      await stage.waitFor();
      check(`${sample.id}/${style}: matching packaged subject`,await page.locator(".subject-layer img").getAttribute("src")===sample.styles[style].subjectUrl);
      check(`${sample.id}/${style}: separate generated-sky scene`,await page.locator(".spatial-canvas").getAttribute("data-background-mode")==="sky-layers");
    }
    const save=async name=>{
      const pending=page.waitForEvent("download");await page.getByRole("button",{name:"Download PNG",exact:true}).click();
      const download=await pending,path=resolve(out,`${sample.id}-${name}.png`);await download.saveAs(path);
      return createHash("sha256").update(readFileSync(path)).digest("hex");
    };
    const centered=await save("center");
    await page.getByRole("button",{name:"Replay transition",exact:true}).click();
    await page.getByRole("button",{name:"Skip animation",exact:true}).waitFor();
    check(`${sample.id}: six-second reveal can replay`,await page.locator(".photo-stage").getAttribute("data-reveal")==="active");
    const during=await save("during-reveal");check(`${sample.id}: reveal does not contaminate PNG`,during===centered);
    await page.getByRole("button",{name:"Skip animation",exact:true}).click();await stage.waitFor();
    await stage.scrollIntoViewIfNeeded();const box=await stage.boundingBox();assert(box);
    await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
    const leftTravel=Number(await stage.getAttribute("data-left-travel"));
    const rightTravel=Number(await stage.getAttribute("data-right-travel"));
    // A source-side cut can legitimately prohibit one direction. Explore the
    // allowed side without weakening the renderer's cut safety.
    const dragFraction=leftTravel>=rightTravel && leftTravel>.0001 ? .8 : .2;
    await page.mouse.move(box.x+box.width*dragFraction,box.y+box.height*.5,{steps:30});await page.waitForTimeout(600);
    check(`${sample.id}: real drag controls virtual camera`,await stage.getAttribute("data-motion-mode")==="drag"&&Math.abs(Number(await stage.getAttribute("data-camera-x")))>.0001);
    const camera=Number(await stage.getAttribute("data-camera-x"));
    check(`${sample.id}: source-cut travel limits remain respected`,camera>=-leftTravel-.0001&&camera<=rightTravel+.0001,{camera,leftTravel,rightTravel});
    await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector(".photo-stage")?.getAttribute("data-motion-mode")==="autonomous",null,{timeout:6000});
    check(`${sample.id}: release resumes bounded drift`,await stage.getAttribute("data-motion-mode")==="autonomous");
    await stage.screenshot({path:resolve(out,`${sample.id}-preview.png`)});
  }
  check("All sample interactions run without backend inference",api.length===0,api);
  await page.goto(`${base}/demo.html`,{waitUntil:"networkidle"});
  await page.locator('.demo-player-frame').waitFor({timeout:30000});
  const play=page.getByRole("button",{name:"Play film",exact:true});await play.click();
  await page.waitForTimeout(1800);await page.getByRole("button",{name:"Pause film",exact:true}).click();
  check("Remotion film plays and pauses",await play.isVisible());
  const scrub=page.getByRole("slider",{name:"Scrub through the demo film"});
  check("Film timeline is exactly 150 seconds",await scrub.getAttribute("max")==="4499");
  for (const frame of [600,1320,2340,3300,3660,4200]) {
    await scrub.fill(String(frame));
    await page.waitForTimeout(400);
    check(`Film chapter at frame ${frame} renders`,await page.locator(".demo-player-frame").isVisible() && await page.locator(".demo-player-failure").count()===0);
  }
  await page.screenshot({path:resolve(out,"film-player.png"),fullPage:true});
  const mp4=await fetch(new URL("/demo/IntoFrame-demo.mp4",base));
  check("Full MP4 is served",mp4.ok && Number(mp4.headers.get("content-length"))>1000000);
  const received=Buffer.from(await mp4.arrayBuffer());
  check("Served MP4 exactly matches committed artifact",createHash("sha256").update(received).digest("hex")===createHash("sha256").update(readFileSync("public/demo/IntoFrame-demo.mp4")).digest("hex"));
  await page.goto(`${base}/experiment.html`,{waitUntil:"domcontentloaded"});
  check("Old isolated experiment entry remains accessible",await page.locator("h1").count()>0);
  check("No JavaScript errors",errors.length===0,errors);
  completed = true;
} catch (cause) {
  failure = String(cause);
  throw cause;
} finally {
  writeFileSync(resolve(out,"results.json"),JSON.stringify({base,checks,completed,failure,passed:completed&&checks.every(x=>x.passed)},null,2));
  await browser.close();
}
console.log(`Submission browser: ${checks.length} checks passed.`);
