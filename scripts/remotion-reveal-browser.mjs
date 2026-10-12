// Web-only validation with frozen, captured real asset/API replies. No inference,
// recording, export video, external upload, camera mutation or browser clock shim.
// node scripts/remotion-reveal-browser.mjs --base http://127.0.0.1:5190
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  assert(value && !value.startsWith("--"), `--${name} requires a value`);
  return value;
}
if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/remotion-reveal-browser.mjs [--base URL] [--manifest PATH] [--out DIR] [--desktop-only | --mobile-only]");
  process.exit(0);
}
const workspace = resolve("."), mediaRoot = resolve("backend/data");
const base = arg("base", "http://127.0.0.1:5190").replace(/\/$/, ""), origin = new URL(base).origin;
const manifestPath = resolve(arg("manifest", "screenshots/depth-motion-fix/manifest.json"));
const outRoot = resolve(arg("out", "screenshots/remotion-reveal/browser"));
const desktopOnly = process.argv.includes("--desktop-only"), mobileOnly = process.argv.includes("--mobile-only");
assert(!(desktopOnly && mobileOnly), "Choose one device filter");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fileHash = path => sha(readFileSync(path));
const localPath = path => relative(workspace, path).replaceAll("\\", "/");
const contentTypes = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".bin": "application/octet-stream" };
const styleLabels = { "cinematic-night": "Cinematic Night", "dreamy-pink": "Dreamy Pink", "golden-hour": "Golden Hour" };
const sourceFiles = ["src/App.tsx", "src/PhotoRevealPlayer.tsx", "src/remotion/PhotoReveal.tsx", "src/remotion/revealTimeline.ts", "src/frameComposition.ts", "src/SpatialFrameScene.tsx", "src/styles.css", "src/exportFrame.ts", "package-lock.json", "scripts/remotion-reveal-browser.mjs"];
const sourceSHA256 = Object.fromEntries(sourceFiles.filter(file => existsSync(file)).map(file => [file, fileHash(file)]));
function inside(path, root) {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}
function mediaUrls(value, found = new Set()) {
  if (typeof value === "string" && value.startsWith("/media/")) found.add(new URL(value, base).pathname);
  else if (Array.isArray(value)) value.forEach(item => mediaUrls(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach(item => mediaUrls(item, found));
  return found;
}
const media = new Map();
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const cases = manifest.cases.map(input => {
  const id = input.jobId || input.job?.result?.id;
  assert(id && input.job?.result && input.depth?.result, "Captured job/depth results are required");
  const assetDir = resolve(input.assetDir || join(mediaRoot, id)), hashes = {};
  for (const url of mediaUrls([input.job, input.depth, input.styles])) {
    const path = resolve(mediaRoot, decodeURIComponent(url.slice(7)));
    assert(inside(path, mediaRoot) && existsSync(path), `Missing or unsafe captured asset: ${url}`);
    const body = readFileSync(path), digest = sha(body), key = inside(path, assetDir) ? relative(assetDir, path).replaceAll("\\", "/") : localPath(path);
    if (input.files?.[key]) assert.equal(digest, input.files[key], `${input.name}: captured bytes changed`);
    hashes[key] = digest;
    media.set(url, { path, body, sha256: digest, contentType: contentTypes[extname(path)] || "application/octet-stream" });
  }
  const photo = resolve(input.photo || join(assetDir, "source.webp"));
  assert(inside(photo, workspace) && existsSync(photo), "Photo must be a checked local workspace file");
  return { ...input, id, photo, hashes, photoSHA256: fileHash(photo), selectedStyle: input.selectedStyle || "cinematic-night" };
});
const plan = [!mobileOnly && { name: "bigben", mobile: false }, !desktopOnly && { name: "dog", mobile: true }].filter(Boolean);
assert(plan.every(item => cases.some(input => input.name === item.name)), "Big Ben and dog fixtures are required");
mkdirSync(outRoot, { recursive: true });

// Reads actual DOM/camera attributes and trusted native input. No state setters,
// clock replacement, rAF override or Player transport interception are installed.
function installObserver() {
  const evidence = { samples: [], events: [] };
  const observe = () => {
    const stage = document.querySelector(".photo-stage"), composition = stage?.querySelector('[data-photo-reveal="composition"]'), player = stage?.querySelector('[data-photo-reveal="player"]');
    if (!stage) return;
    evidence.samples.push({ time: performance.now(), reveal: stage.dataset.reveal, frame: composition ? Number(composition.dataset.revealFrame) : null,
      phase: composition?.dataset.revealPhase, styleProgress: composition ? Number(composition.dataset.revealStyleProgress) : null,
      bars: composition ? Number(composition.dataset.revealBarFraction) : null, state: player?.dataset.revealState,
      mode: stage.dataset.motionMode, cameraX: Number(stage.dataset.cameraX), cameraTargetX: Number(stage.dataset.cameraTargetX),
      interactive: stage.classList.contains("spatial-ready") });
    if (evidence.samples.length > 7000) evidence.samples.shift();
  };
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    document.addEventListener(type, event => {
      const stage = document.querySelector(".photo-stage");
      if (stage && (event.target === stage || stage.contains(event.target))) evidence.events.push({ type, pointerType: event.pointerType, trusted: event.isTrusted,
        clientX: event.clientX, clientY: event.clientY, time: performance.now(), reveal: stage.dataset.reveal });
    }, true);
  }
  setInterval(observe, 25);
  window.__revealEvidence = evidence;
}
async function geometry(page) {
  return page.locator(".photo-stage").evaluate(stage => {
    const rect = element => {
      if (!element) return null;
      const box = element.getBoundingClientRect(), css = getComputedStyle(element);
      return { x: box.x, y: box.y, width: box.width, height: box.height, zIndex: css.zIndex, opacity: css.opacity,
        clipPath: css.clipPath, transform: css.transform, visibility: css.visibility };
    };
    const composition = stage.querySelector('[data-photo-reveal="composition"]'), player = stage.querySelector('[data-photo-reveal="player"]');
    return { stage: { ...stage.dataset }, cameraX: Number(stage.dataset.cameraX), cameraTargetX: Number(stage.dataset.cameraTargetX), mode: stage.dataset.motionMode,
      interactive: stage.classList.contains("spatial-ready"), rect: rect(stage), composition: composition ? { ...composition.dataset } : null,
      player: player ? { ...player.dataset } : null, overlay: rect(stage.querySelector(".photo-reveal-overlay")),
      layers: Object.fromEntries(["source", "styled-group", "background-clip", "background", "subject"].map(layer => [layer, rect(stage.querySelector(`[data-reveal-layer="${layer}"]`))])),
      photoZoom: Number(stage.style.getPropertyValue("--photo-zoom")), photoX: stage.style.getPropertyValue("--photo-x"), photoY: stage.style.getPropertyValue("--photo-y"),
      subjectUrl: stage.querySelector(".subject-layer img")?.getAttribute("src"), backgroundUrl: stage.querySelector(".background-content > img")?.getAttribute("src"),
      canvases: [...stage.querySelectorAll("canvas")].map(canvas => ({ width: canvas.width, height: canvas.height, visibility: canvas.style.visibility, data: { ...canvas.dataset } })),
      images: [...stage.querySelectorAll("img")].map(image => ({ src: image.getAttribute("src"), width: image.naturalWidth, height: image.naturalHeight, complete: image.complete })) };
  });
}
async function ready(page, input, style = null) {
  const subject = style ? input.styles[style].result.subjectUrl : input.job.result.subjectUrl;
  const background = style ? input.styles[style].result.renderBackgroundUrl : input.depth.result.backgroundUrl;
  await page.getByText("YOUR FRAME IS READY", { exact: true }).waitFor({ timeout: 20000 });
  await page.waitForFunction(expected => {
    const stage = document.querySelector(".photo-stage"), canvas = stage?.querySelector(".spatial-canvas canvas");
    return stage?.querySelector(".subject-layer img")?.getAttribute("src") === expected.subject &&
      stage?.querySelector(".background-content > img")?.getAttribute("src") === expected.background &&
      stage?.dataset.subjectGeometry === "depth-mesh" && canvas?.style.visibility === "visible" && canvas?.dataset.backgroundUrl === expected.background;
  }, { subject, background }, { timeout: 30000 });
}
async function waitActive(page) {
  await page.waitForFunction(() => document.querySelector(".photo-stage")?.dataset.reveal === "active" &&
    document.querySelector('[data-photo-reveal="composition"]') !== null, null, { timeout: 20000 });
}
async function waitIdle(page) {
  await page.waitForFunction(() => document.querySelector(".photo-stage")?.dataset.reveal === "idle" &&
    !document.querySelector('[data-photo-reveal="player"]'), null, { timeout: 12000 });
}
async function waitFrame(page, frame) {
  await page.waitForFunction(expected => Number(document.querySelector('[data-photo-reveal="composition"]')?.getAttribute("data-reveal-frame")) >= expected,
    frame, { timeout: 10000 });
}
async function samplePixels(page, screenshotPath, expectedUrl) {
  const screenshot = `data:image/png;base64,${readFileSync(screenshotPath).toString("base64")}`;
  return page.evaluate(async ({ screenshot, expectedUrl }) => {
    const load = url => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
    const [actual, expected] = await Promise.all([load(screenshot), load(expectedUrl)]);
    const canvas = document.createElement("canvas"); canvas.width = actual.naturalWidth; canvas.height = actual.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const points = [[.08,.04],[.92,.04],[.50,.07],[.08,.20],[.24,.30],[.74,.30],[.92,.20],[.08,.5],[.5,.5],[.92,.5],[.22,.72],[.76,.72],[.08,.84],[.92,.84],[.08,.96],[.5,.96],[.92,.96]];
    function samples(image) { context.clearRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,canvas.width,canvas.height); return points.map(([x,y]) => [...context.getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data]); }
    const got = samples(actual), want = samples(expected), comparisons = got.map((rgba,index) => ({ point: points[index], actual: rgba, expected: want[index], maximumDifference: Math.max(...rgba.slice(0,3).map((value,channel) => Math.abs(value-want[index][channel]))) }));
    const sorted = comparisons.map(point => point.maximumDifference).sort((a,b)=>a-b);
    return { nativeExpected: { width: expected.naturalWidth, height: expected.naturalHeight }, screenshot: { width: actual.naturalWidth, height: actual.naturalHeight }, comparisons,
      medianDifference: sorted[Math.floor(sorted.length/2)], maximumDifference: sorted.at(-1), within22: sorted.filter(value=>value<=22).length,
      method: "17 fixed pixel samples from actual visible stage screenshot and native PNG/source scaled to that screenshot size; not a whole-image byte comparison." };
  }, { screenshot, expectedUrl });
}
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-webgl"] });
const records = [];
try {
  for (const item of plan) {
    const input = cases.find(value => value.name === item.name), device = item.mobile ? "mobile" : "desktop", out = join(outRoot, `${input.name}-${device}`);
    mkdirSync(out, { recursive: true });
    const viewport = item.mobile ? { width: 390, height: 844 } : { width: 1440, height: 1050 };
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: item.mobile, hasTouch: item.mobile, acceptDownloads: true });
    await context.addInitScript(installObserver);
    const page = await context.newPage(), touch = item.mobile ? await context.newCDPSession(page) : null;
    const checks = [], errors = [], consoleErrors = [], httpErrors = [], requests = [], mediaRequests = [], unknownRequests = [], blockedExternal = [], screenshots = [], servedSourceSHA256 = {};
    let activeInput = input, failBackgroundOnce = false, expected503 = null;
    const check = (name, passed, evidence) => checks.push({ name, passed: Boolean(passed), ...(evidence === undefined ? {} : { evidence }) });
    const record = { name: input.name, device, viewport, base, mode: "frozen-real-asset-replay", newInference: false, videoRecordings: false, physicalPhoneTest: false,
      sourceManifest: localPath(manifestPath), manifestSHA256: fileHash(manifestPath), photo: localPath(input.photo), photoSHA256: input.photoSHA256,
      assetHashes: input.hashes, sourceSHA256, servedSourceSHA256, api: { job: input.job, depth: input.depth, styles: input.styles },
      checks, errors, consoleErrors, httpErrors, requests, mediaRequests, unknownRequests, blockedExternal, screenshots,
      observation: "Actual Remotion frame/data attributes, native visible stage screenshots, mouse or CDP touch input. DOM and camera are observed, never assigned; existing inference replies and local media are replayed." };
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("response", async response => {
      if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
      if (/\.(?:js|tsx?|css)(?:\?|$)/.test(response.url())) try { servedSourceSHA256[new URL(response.url()).pathname] = sha(await response.body()); } catch { /* Aborted response. */ }
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), path = decodeURIComponent(url.pathname);
      if (url.origin !== origin) { blockedExternal.push({ url: url.href, method: request.method() }); await route.fulfill({ status: 200, contentType: path.endsWith(".css") || url.hostname === "fonts.googleapis.com" ? "text/css" : "application/octet-stream", body: "" }); return; }
      if (path.startsWith("/api/")) {
        requests.push({ path, method: request.method(), time: Date.now() });
        let body;
        if (path === "/api/jobs" && request.method() === "POST") body = { id: activeInput.id };
        else if (path === `/api/jobs/${activeInput.id}` && request.method() === "GET") body = activeInput.job;
        else if (path === "/api/depth" && request.method() === "POST") body = { id: activeInput.id };
        else if (path === `/api/depth/${activeInput.id}` && request.method() === "GET") body = activeInput.depth;
        else if (path === "/api/restyle" && request.method() === "POST") { const style = request.postDataJSON().style; if (activeInput.styles[style]) body = { id: activeInput.id, style }; }
        else if (path.startsWith(`/api/restyle/${activeInput.id}/`) && request.method() === "GET") body = activeInput.styles[path.split("/").at(-1)];
        if (!body) unknownRequests.push({ path, method: request.method() });
        await route.fulfill({ status: body ? 200 : 400, contentType: "application/json", body: JSON.stringify(body || { detail: "Uncaptured API blocked. No inference is permitted in this replay." }) }); return;
      }
      if (path.startsWith("/media/")) {
        const saved = media.get(url.pathname), failure = failBackgroundOnce && url.pathname === input.styles[input.selectedStyle].result.backgroundUrl;
        if (failure) { failBackgroundOnce = false; expected503 = { path, time: Date.now() }; }
        mediaRequests.push({ path, sha256: saved?.sha256, file: saved ? localPath(saved.path) : null, injected503: failure });
        if (!saved) unknownRequests.push({ path, method: request.method() });
        await route.fulfill({ status: failure ? 503 : saved ? 200 : 404, contentType: saved?.contentType || "text/plain", headers: { "cache-control": "no-store" }, body: failure ? "Intentional reveal-native-background failure" : saved?.body || "Uncaptured media blocked." }); return;
      }
      await route.continue();
    });
    async function capture(name) {
      await page.locator(".photo-stage").scrollIntoViewIfNeeded();
      const before = await geometry(page), path = join(out, `${name}.png`), clip = await page.locator(".photo-stage").boundingBox(); assert(clip);
      await page.screenshot({ path, clip });
      const after = await geometry(page);
      screenshots.push({ name, file: `${name}.png`, sha256: fileHash(path), before, after });
      return { path, before, after };
    }
    async function download(name) {
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download PNG", exact: true }).evaluate(button => button.click());
      const path = join(out, `${name}.png`); await (await pending).saveAs(path);
      return { path, sha256: fileHash(path), dataUrl: `data:image/png;base64,${readFileSync(path).toString("base64")}` };
    }
    async function replay() {
      await page.getByRole("button", { name: "Replay transition", exact: true }).evaluate(button => button.click());
      await waitActive(page);
    }
    async function drag() {
      await page.locator(".photo-stage").scrollIntoViewIfNeeded(); const box = await page.locator(".photo-stage").boundingBox(); assert(box);
      const start = { x: box.x + box.width * .55, y: box.y + box.height * .55 }, end = { x: start.x + box.width * .16, y: start.y };
      if (touch) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
        for (let step = 1; step <= 6; step++) { await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x-start.x)*step/6, y: start.y }] }); await page.waitForTimeout(20); }
      } else { await page.mouse.move(start.x,start.y); await page.mouse.down(); await page.mouse.move(end.x,end.y,{ steps: 8 }); }
      await page.waitForTimeout(280); const held = await geometry(page);
      if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); else await page.mouse.up();
      return held;
    }
    async function cancelled(name, action, expected) {
      await replay(); await waitFrame(page, 35); await action(); await waitIdle(page);
      const immediate = await geometry(page); await page.waitForTimeout(6400); const late = await geometry(page);
      check(`${name}: cancels and stays cancelled after the old duration`, immediate.stage.reveal === "idle" && late.stage.reveal === "idle" && !late.player && expected(late), { immediate, late });
    }
    try {
      await page.goto(base,{ waitUntil: "domcontentloaded", timeout: 30000 });
      await page.locator("input[type=file]").setInputFiles(input.photo); await ready(page,input);
      await page.getByRole("button",{ name: styleLabels[input.selectedStyle], exact: false }).click();
      const apiBeforeGenerate = requests.length;
      await page.getByRole("button",{ name: "Generate background", exact: true }).evaluate(button => button.click());
      const started = Date.now(); await waitActive(page);
      const original = await capture("01-original"); record.original = original;
      record.playingHint = await page.locator(".phase-note").innerText();
      check("Playing hint explains the active transition", record.playingHint === "Playing the photo transition · Skip animation to return to the preview.",record.playingHint);
      check("Generate automatically starts native original photograph", Number(original.before.composition?.revealFrame) < 24 && Number(original.before.composition?.revealStyleProgress) === 0 && Number(original.before.composition?.revealBarFraction) === 0 &&
        original.before.player?.revealSource === input.job.result.sourceUrl && original.before.player?.revealWidth === String(input.job.result.width) && original.before.overlay?.zIndex === "6", original);
      record.originalPixels = await samplePixels(page,original.path,input.job.result.sourceUrl);
      check("Original source is visibly above the existing scene", record.originalPixels.medianDifference <= 12 && record.originalPixels.within22 >= 15, record.originalPixels);
      const apiAfterGenerate = requests.length;
      check("Only the captured restyle call was needed to generate", apiAfterGenerate-apiBeforeGenerate === 2, requests.slice(apiBeforeGenerate));
      await waitFrame(page,48); record.crossfade = await capture("02-whole-style-crossfade");
      const cross = record.crossfade.before, layers = [cross.layers.source,cross.layers.background,cross.layers.subject];
      check("Styled background and subject crossfade together in aligned pose", Number(cross.composition?.revealStyleProgress)>0 && Number(cross.composition?.revealStyleProgress)<1 &&
        layers.every(layer => layer && Math.abs(layer.x-layers[0].x)<.01 && Math.abs(layer.y-layers[0].y)<.01 && Math.abs(layer.width-layers[0].width)<.01 && Math.abs(layer.height-layers[0].height)<.01), cross);
      record.duringRevealDrag = await drag();
      check("Native drag is suspended during transition", !record.duringRevealDrag.interactive && record.duringRevealDrag.stage.reveal === "active" && Math.abs(record.duringRevealDrag.cameraX)<.0001, record.duringRevealDrag);
      record.exportDuring = await download("export-during-transition"); delete record.exportDuring.dataUrl;
      await waitFrame(page,112); record.popout = await capture("03-bars-closing-popout");
      const pop = record.popout.before;
      check("Bars close while foreground stays outside their clip", Number(pop.composition?.revealBarFraction)>0 && Number(pop.composition?.revealBarFraction)<.13 && Number(pop.composition?.revealStyleProgress)===1 &&
        pop.layers["background-clip"]?.clipPath.includes("inset") && pop.layers.subject?.clipPath === "none", pop);
      await waitFrame(page,146); record.final = await capture("04-final-hold-frame");
      check("Final hold is the native centered 13 percent bar composition", Number(record.final.before.composition?.revealBarFraction)===.13 &&
        Number(record.final.before.composition?.revealStyleProgress)===1 && Number(record.final.before.composition?.revealZoom)===record.final.before.photoZoom, record.final);
      await waitIdle(page); record.normalDurationMilliseconds = Date.now()-started;
      await ready(page,input,input.selectedStyle); record.handover = await capture("05-depth-scene-handover");
      record.handoverHint = await page.locator(".phase-note").innerText();
      check("Handover restores the native drag hint", record.handoverHint.startsWith("DRAG TO EXPLORE ·"),record.handoverHint);
      check("Normal end hands back to the existing subject depth mesh", record.handover.before.stage.subjectGeometry === "depth-mesh" && record.handover.before.subjectUrl === input.styles[input.selectedStyle].result.subjectUrl && record.handover.before.mode === "autonomous", record.handover);
      check("Natural reveal completes near six seconds", record.normalDurationMilliseconds>=5700 && record.normalDurationMilliseconds<=10000, record.normalDurationMilliseconds);
      record.exportAfter = await download("export-after-transition");
      check("PNG bytes stay identical during transition and after completion", record.exportDuring.sha256 === record.exportAfter.sha256, { during: record.exportDuring.sha256, after: record.exportAfter.sha256 });
      record.finalPixels = await samplePixels(page,record.final.path,record.exportAfter.dataUrl); delete record.exportAfter.dataUrl;
      check("Visible final hold matches native PNG samples", record.finalPixels.medianDifference<=12 && record.finalPixels.within22>=15, record.finalPixels);
      check("Reveal and PNG create no additional API jobs", requests.length===apiAfterGenerate, requests.slice(apiAfterGenerate));
      record.afterDrag = await drag();
      check("Native drag works after reveal handover", record.afterDrag.mode === "drag" && record.afterDrag.interactive && Math.abs(record.afterDrag.cameraX)>.0005, record.afterDrag);
      await page.waitForTimeout(350);
      const beforeReplay = requests.length; await replay(); record.replayOriginal = await capture("06-replay-original");
      check("Replay begins with original frame again", Number(record.replayOriginal.before.composition?.revealFrame)<24 && Number(record.replayOriginal.before.composition?.revealStyleProgress)===0, record.replayOriginal);
      await page.getByRole("button",{ name: "Skip animation", exact: true }).evaluate(button=>button.click()); await waitIdle(page);
      record.skipped = await capture("07-skip-to-current-preview");
      check("Skip restores current preview without a new API call", requests.length===beforeReplay && record.skipped.before.subjectUrl===input.styles[input.selectedStyle].result.subjectUrl && record.skipped.before.mode === "autonomous", record.skipped);
      if (!item.mobile) {
        await cancelled("Before", () => page.getByRole("button",{ name: "View before", exact: true }).evaluate(button=>button.click()), value=>value.subjectUrl===input.job.result.subjectUrl && !value.interactive);
        await page.getByRole("button",{ name: "View after", exact: true }).click(); await ready(page,input,input.selectedStyle);
        await cancelled("Mask", () => page.getByRole("button",{ name: "View mask", exact: true }).evaluate(button=>button.click()), value=>!value.interactive);
        await page.getByRole("button",{ name: "Hide mask", exact: true }).click();
        await cancelled("Style switch", () => page.getByRole("button",{ name: "Dreamy Pink", exact: false }).evaluate(button=>button.click()), value=>value.subjectUrl===input.job.result.subjectUrl);
        await page.getByRole("button",{ name: styleLabels[input.selectedStyle], exact: false }).click(); await ready(page,input,input.selectedStyle);
        await page.getByRole("button",{ name: "Adjust frame", exact: true }).click();
        const cropBefore = (await geometry(page)).photoZoom;
        await cancelled("Crop change", async () => { await page.locator('input[type="range"]').focus(); await page.keyboard.press("ArrowRight"); }, value=>value.photoZoom>cropBefore);
        await page.getByRole("button",{ name: "Reset crop", exact: true }).click();
        await page.getByRole("button",{ name: "Close controls", exact: true }).click();
        await replay(); await waitFrame(page,35); await page.emulateMedia({ reducedMotion: "reduce" }); await waitIdle(page);
        record.reducedCancel = await geometry(page);
        check("Reduced motion cancels current reveal and disables replay", !record.reducedCancel.interactive && await page.getByRole("button",{ name: "Replay transition", exact: true }).isDisabled(),record.reducedCancel);
        const alternateStyle = Object.keys(input.styles).find(style=>style!==input.selectedStyle);
        assert(alternateStyle,"Reduced-motion generate needs another captured style");
        await page.getByRole("button",{ name: styleLabels[alternateStyle], exact: false }).click();
        await page.getByRole("button",{ name: "Generate background", exact: true }).click(); await ready(page,input,alternateStyle);
        await page.waitForTimeout(500); record.reducedGenerate = await capture("08-reduced-motion-static-result");
        check("Generate under reduced motion presents a static result", record.reducedGenerate.before.stage.reveal === "idle" && !record.reducedGenerate.before.player && !record.reducedGenerate.before.interactive &&
          await page.getByRole("button",{ name: "Replay transition", exact: true }).isDisabled(),record.reducedGenerate);
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.getByRole("button",{ name: styleLabels[input.selectedStyle], exact: false }).click(); await ready(page,input,input.selectedStyle);
        const apiBeforeFailure = requests.length; failBackgroundOnce = true;
        await page.getByRole("button",{ name: "Replay transition", exact: true }).evaluate(button=>button.click());
        await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent?.includes("过渡"),null,{ timeout: 25000 });
        await waitIdle(page); await ready(page,input,input.selectedStyle); record.assetFailure = await capture("09-native-background-503-fallback");
        check("Failed native reveal image restores existing depth preview with a clear message", expected503!==null && record.assetFailure.before.stage.reveal === "idle" && record.assetFailure.before.stage.subjectGeometry === "depth-mesh" &&
          record.assetFailure.before.subjectUrl===input.styles[input.selectedStyle].result.subjectUrl && record.assetFailure.before.mode === "autonomous" && requests.length===apiBeforeFailure,
          { injected: expected503, preview: record.assetFailure, alert: await page.getByRole("alert").innerText() });
        await replay(); await waitFrame(page,35);
        await page.getByRole("button",{ name: "New photo", exact: true }).evaluate(button=>button.click());
        await page.waitForTimeout(6400);
        check("New photo cancels and no old Player callback restores the previous scene", await page.locator(".photo-stage").count()===0 && await page.locator('[data-photo-reveal="player"]').count()===0);
        await page.locator("input[type=file]").setInputFiles(input.photo); await ready(page,input);
        await page.getByRole("button",{ name: styleLabels[input.selectedStyle], exact: false }).click();
        await page.getByRole("button",{ name: "Generate background", exact: true }).evaluate(button=>button.click()); await waitActive(page); await waitFrame(page,35);
        const alternate=cases.find(value=>value.name==="dog"); activeInput=alternate;
        await page.locator("input[type=file]").setInputFiles(alternate.photo); await ready(page,alternate); await page.waitForTimeout(6400);
        record.reupload=await capture("10-reupload-discards-old-transition");
        check("Reupload uses the new depth scene with no stale transition", record.reupload.before.stage.reveal === "idle" && record.reupload.before.subjectUrl===alternate.job.result.subjectUrl && !record.reupload.before.player && record.reupload.before.stage.subjectGeometry==="depth-mesh",record.reupload);
      }
      record.pointerEvents = await page.evaluate(()=>window.__revealEvidence.events);
      record.observedFrames = await page.evaluate(()=>window.__revealEvidence.samples);
      record.overflow = await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
      check("Native input evidence is trusted", record.pointerEvents.some(event=>event.type==="pointerdown" && event.trusted && event.pointerType===(item.mobile?"touch":"mouse")), record.pointerEvents.filter(event=>event.type==="pointerdown"));
      check("No horizontal page overflow", record.overflow<=1, record.overflow);
      check("Only captured APIs and media used", unknownRequests.length===0, unknownRequests);
      check("No JavaScript errors", errors.length===0, errors);
      check("No unexpected console errors", consoleErrors.every(error=>expected503 && error.includes("503")),consoleErrors);
      check("No unexpected HTTP errors", httpErrors.every(error=>error.status===503 && new URL(error.url).pathname===expected503?.path), httpErrors);
      record.completed = true;
    } catch (error) {
      record.completed = false; record.failure = error.stack || error.message; check("Scenario completed",false,error.message);
      record.failureBody = await page.locator("body").innerText().catch(()=>""); record.failureGeometry = await geometry(page).catch(()=>null);
      record.observedFrames = await page.evaluate(()=>window.__revealEvidence?.samples||[]).catch(()=>[]);
      await page.screenshot({ path: join(out,"failure.png"), fullPage: true }).catch(()=>{});
    } finally {
      await context.close(); record.passed = record.completed && checks.every(value=>value.passed);
      record.screenshotHashes = Object.fromEntries(readdirSync(out).filter(file=>file.endsWith(".png")).map(file=>[file,fileHash(join(out,file))]));
      writeFileSync(join(out,"results.json"),JSON.stringify(record,null,2)); records.push(record);
      writeFileSync(join(outRoot,"results.json"),JSON.stringify(records,null,2));
      console.log(JSON.stringify({ name: input.name, device, passed: record.passed, checks: checks.length, failures: checks.filter(value=>!value.passed).map(value=>value.name), failure: record.failure, out: localPath(out) }));
    }
  }
} finally { await browser.close(); }
const summary = { base, mode: "frozen-real-asset-replay", newInference: false, videoRecordings: false, physicalPhoneTest: false, completedAt: new Date().toISOString(),
  cases: records.map(record=>({ name: record.name, device: record.device, passed: record.passed, checks: record.checks.length, failures: record.checks.filter(check=>!check.passed).map(check=>check.name) })),
  checkTotal: records.reduce((sum,record)=>sum+record.checks.length,0), passed: records.every(record=>record.passed) };
writeFileSync(join(outRoot,"summary.json"),JSON.stringify(summary,null,2)); console.log(JSON.stringify(summary));
if (!summary.passed) process.exitCode=1;
