// Browser evidence for the real cached depth/sky pipeline. Never runs inference.
// node scripts/depth-motion-browser.mjs --base http://127.0.0.1:5187 --manifest screenshots/depth-motion-fix/manifest.json --out screenshots/depth-motion-fix/after --include bigben,dog,paris
// Use --baseline for the old bundle. Use --compare <baseline/results.json> on the new bundle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  assert(value && !value.startsWith("--"), `--${name} requires a value`);
  return value;
}
if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/depth-motion-browser.mjs --base URL --manifest PATH --out DIR [--include bigben,dog,paris] [--baseline] [--desktop-only | --mobile-only] [--compare baseline/results.json] [--camera 0.02] [--hold-ms 7600] [--record-all] [--cancel-only]");
  process.exit(0);
}
const workspace = resolve(".");
const mediaRoot = resolve("backend/data");
const manifestPath = resolve(argument("manifest", "screenshots/depth-motion-fix/manifest.json"));
const base = argument("base", process.env.INTOFRAME_URL || "http://127.0.0.1:5187").replace(/\/$/, "");
const baseOrigin = new URL(base).origin;
const outRoot = resolve(argument("out", "screenshots/depth-motion-fix/browser-after"));
const baseline = process.argv.includes("--baseline");
const cancelOnly = process.argv.includes("--cancel-only");
const desktopOnly = process.argv.includes("--desktop-only");
const mobileOnly = process.argv.includes("--mobile-only");
assert(!(desktopOnly && mobileOnly), "Choose either --desktop-only or --mobile-only");
const include = argument("include", "bigben,dog,paris").split(",").map(value => value.trim());
const comparePath = argument("compare", null);
const cameraTarget = Number(argument("camera", "0.02"));
const holdMilliseconds = Number(argument("hold-ms", "7600"));
assert(cameraTarget > 0 && cameraTarget <= 0.1, "--camera must be between 0 and 0.1");
assert(holdMilliseconds >= 5000 && holdMilliseconds <= 20000, "--hold-ms must be between 5000 and 20000");
const styleLabels = { "dreamy-pink": "Dreamy Pink", "golden-hour": "Golden Hour", "cinematic-night": "Cinematic Night" };
const sha = buffer => createHash("sha256").update(buffer).digest("hex");
const fileHash = path => sha(readFileSync(path));
const localPath = path => relative(workspace, path).replaceAll("\\", "/");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const modelFiles = ["src/App.tsx", "src/SpatialFrameScene.tsx", "src/depthGeometry.ts", "src/parallax.ts", "src/frameComposition.ts", "src/styles.css", "src/api.ts", "src/exportFrame.ts", "package-lock.json"];
const sourceSHA256 = Object.fromEntries(modelFiles.filter(path => existsSync(resolve(path))).map(path => [path, fileHash(resolve(path))]));
const baselineSourceRoot = resolve("screenshots/depth-motion-fix/baseline");
const baselineSourceSHA256 = baseline && existsSync(baselineSourceRoot)
  ? Object.fromEntries(modelFiles.filter(path => existsSync(join(baselineSourceRoot, path))).map(path => [path, fileHash(join(baselineSourceRoot, path))])) : null;
const contentTypes = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".json": "application/json", ".bin": "application/octet-stream" };
function inside(path, root) {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}
function mediaUrls(value, found = new Set()) {
  if (typeof value === "string" && value.startsWith("/media/")) found.add(new URL(value, base).pathname);
  else if (Array.isArray(value)) value.forEach(item => mediaUrls(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach(item => mediaUrls(item, found));
  return found;
}
const media = new Map();
const rawCases = manifest.cases || (manifest.job ? [manifest] : Object.entries(manifest).map(([name, value]) => ({ name, ...value })));
const cases = rawCases.map((value, index) => {
  const name = value.name || `case-${index}`;
  assert(/^[a-z0-9_-]+$/i.test(name), "Case names must be safe directory names");
  const id = value.jobId || value.job?.result?.id;
  assert(id && value.job?.result && value.depth?.result, `${name}: captured job/depth results are required`);
  const styles = value.styles || { [value.style?.result?.style || "cinematic-night"]: value.style };
  const assetDir = resolve(value.assetDir || join(mediaRoot, id));
  assert(inside(assetDir, workspace), `${name}: asset directory must be inside the workspace`);
  const hashes = {};
  for (const url of mediaUrls([value.job, value.depth, styles])) {
    const path = resolve(mediaRoot, decodeURIComponent(url.slice("/media/".length)));
    assert(inside(path, mediaRoot), `${name}: media path escaped backend/data`);
    assert(existsSync(path), `${name}: missing frozen media ${localPath(path)}`);
    const body = readFileSync(path), digest = sha(body);
    const key = inside(path, assetDir) ? relative(assetDir, path).replaceAll("\\", "/") : localPath(path);
    const expected = value.files?.[key];
    if (expected) assert.equal(digest, expected, `${name}: cached source changed: ${key}`);
    hashes[key] = digest;
    media.set(url, { path, body, sha256: digest, contentType: contentTypes[extname(path)] || "application/octet-stream" });
  }
  const photo = resolve(value.photo || join(assetDir, "source.webp"));
  assert(inside(photo, workspace) && existsSync(photo), `${name}: photo must be a local workspace file`);
  return { ...value, name, id, styles, assetDir, photo, hashes, selectedStyle: value.selectedStyle || "cinematic-night", photoSHA256: fileHash(photo) };
});
const selectedCases = cases.filter(value => include.includes(value.name));
assert(selectedCases.length, "--include did not select any manifest cases");
mkdirSync(outRoot, { recursive: true });
const records = [];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-webgl"] });

// The clock is injected only in this browser. Product files and camera state are untouched.
// Normal runs use native frame timestamps; matching-camera captures slow time only near
// the requested natural crossing and suspend future callbacks after that rendered frame.
function browserClock() {
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  let nextId = 1, virtualNow = performance.now(), lastNative = null, speed = 1;
  const callbacks = new Map(), cancelled = new Set();
  const state = { frozen: false, target: null, armStart: 0, captured: null, samples: [], sampling: false, sampleStart: 0 };
  function inspect() {
    const stage = document.querySelector(".photo-stage");
    if (!stage) return;
    const cameraX = Number(stage.dataset.cameraX || 0), wake = Number(stage.style.getPropertyValue("--wake") || 0);
    if (state.sampling) {
      const previous = state.samples.at(-1);
      if (!previous || previous.time !== virtualNow) state.samples.push({ time: virtualNow, milliseconds: virtualNow - state.sampleStart, cameraX, wake, awake: stage.classList.contains("is-awake") });
    }
    if (state.target !== null) {
      const sign = Math.sign(state.target), target = Math.abs(state.target), directed = sign * cameraX;
      speed = Math.abs(directed - target) < 0.004 ? 0.12 : 1;
      if (Math.abs(directed - target) <= 0.00012 && wake >= 0.999) {
        state.frozen = true;
        state.captured = { cameraX, wake, time: virtualNow, target: state.target, error: cameraX - state.target, nativeClock: false };
      }
    }
  }
  function schedule(id) {
    const entry = callbacks.get(id);
    if (!entry || cancelled.has(id)) return;
    entry.nativeId = nativeRAF(now => {
      if (!callbacks.has(id) || cancelled.has(id)) return;
      if (state.frozen) { entry.nativeId = null; return; }
      if (now !== lastNative) {
        virtualNow += lastNative === null ? Math.max(0, now - virtualNow) : Math.max(0, now - lastNative) * speed;
        lastNative = now;
      }
      callbacks.delete(id);
      entry.callback(virtualNow);
      inspect();
    });
  }
  window.requestAnimationFrame = callback => { const id = nextId++; callbacks.set(id, { callback, nativeId: null }); schedule(id); return id; };
  window.cancelAnimationFrame = id => { const entry = callbacks.get(id); if (entry?.nativeId !== null) nativeCancel(entry?.nativeId); callbacks.delete(id); cancelled.add(id); };
  window.__depthEvidence = {
    state,
    freeze() { state.frozen = true; },
    resume() {
      state.frozen = false; state.target = null; speed = 1; lastNative = null; virtualNow = performance.now();
      for (const [id, entry] of callbacks) if (entry.nativeId === null) schedule(id);
    },
    arm(target) { state.target = target; state.captured = null; state.armStart = performance.now(); speed = 1; },
    sample() { state.samples = []; state.sampleStart = virtualNow; state.sampling = true; },
    stopSample() { state.sampling = false; return state.samples; },
  };
}

async function geometry(page) {
  return page.locator(".photo-stage").evaluate(stage => {
    const host = stage.querySelector(".spatial-canvas"), subjectHost = stage.querySelector(".subject-depth-layer");
    const subject = stage.querySelector(".subject-layer img"), background = stage.querySelector(".background-content > img");
    const rect = stage.getBoundingClientRect();
    const style = element => element ? { zIndex: getComputedStyle(element).zIndex, visibility: getComputedStyle(element).visibility, display: getComputedStyle(element).display, transform: getComputedStyle(element).transform } : null;
    const bar = selector => { const element = stage.querySelector(selector); return element ? { ...style(element), height: element.getBoundingClientRect().height, background: getComputedStyle(element).backgroundColor } : null; };
    return {
      cameraX: Number(stage.dataset.cameraX || 0), wake: Number(stage.style.getPropertyValue("--wake") || 0),
      awake: stage.classList.contains("is-awake"), interactive: stage.classList.contains("spatial-ready"),
      width: stage.clientWidth, height: stage.clientHeight, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      zoom: Number(stage.style.getPropertyValue("--photo-zoom") || 1), shiftX: stage.style.getPropertyValue("--photo-x"), shiftY: stage.style.getPropertyValue("--photo-y"),
      subjectX: parseFloat(stage.style.getPropertyValue("--subject-parallax-x")) || 0, subjectScale: stage.style.getPropertyValue("--subject-parallax-scale"),
      subjectUrl: subject?.getAttribute("src"), backgroundUrl: background?.getAttribute("src"),
      stageData: { ...stage.dataset }, hostData: host ? { ...host.dataset } : null, subjectHostData: subjectHost ? { ...subjectHost.dataset } : null,
      canvases: [...stage.querySelectorAll("canvas")].map(canvas => ({ width: canvas.width, height: canvas.height, ...style(canvas), data: { ...canvas.dataset }, parentClass: canvas.parentElement.className })),
      layers: { background: style(stage.querySelector(".background-layer")), subject: style(stage.querySelector(".subject-layer")), subjectMesh: style(subjectHost) },
      bars: { top: bar(".letterbox-top"), bottom: bar(".letterbox-bottom") },
      images: [...stage.querySelectorAll("img")].map(img => ({ src: img.getAttribute("src"), complete: img.complete, width: img.naturalWidth, height: img.naturalHeight })),
    };
  });
}
async function settled(page) {
  await page.waitForFunction(() => {
    const stage = document.querySelector(".photo-stage");
    return stage && !stage.classList.contains("is-awake") && Math.abs(Number(stage.dataset.cameraX || 0)) <= 0.0001 && Number(stage.style.getPropertyValue("--wake") || 0) <= 0.0002;
  }, null, { timeout: 15000 });
}
async function ready(page, expectedSubject, expectMesh) {
  const source = cases.find(input => input.job.result.subjectUrl === expectedSubject);
  const styled = source ? null : cases.flatMap(input => Object.values(input.styles)).find(value => value?.result?.subjectUrl === expectedSubject)?.result;
  const expectedBackground = source?.depth.result.backgroundUrl || styled?.renderBackgroundUrl;
  const expectedMode = source ? "photo-depth" : "sky-layers";
  await page.getByText("YOUR FRAME IS READY", { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForFunction(({ expectedSubject, expectMesh, expectedBackground, expectedMode }) => {
    const stage = document.querySelector(".photo-stage");
    return stage?.querySelector(".subject-layer img")?.getAttribute("src") === expectedSubject &&
      stage.querySelector(".spatial-canvas canvas")?.style.visibility === "visible" &&
      stage.querySelector(".spatial-canvas")?.dataset.backgroundMode === expectedMode &&
      stage.querySelector(".spatial-canvas canvas")?.dataset.backgroundUrl === expectedBackground &&
      stage.querySelector(".background-content > img")?.getAttribute("src") === expectedBackground &&
      stage.dataset.cameraX !== undefined && Number.isFinite(Number(stage.dataset.cameraX)) &&
      (!expectMesh || stage.dataset.subjectGeometry === "depth-mesh") &&
      [...stage.querySelectorAll("img")].every(img => img.complete && img.naturalWidth > 0);
  }, { expectedSubject, expectMesh, expectedBackground, expectedMode }, { timeout: 45000 });
  await settled(page);
}
async function download(page, path) {
  const pending = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: "Download PNG", exact: true }).evaluate(button => button.click());
  await (await pending).saveAs(path);
  return fileHash(path);
}
const range = samples => samples.length ? [Math.min(...samples.map(value => value.cameraX)), Math.max(...samples.map(value => value.cameraX))] : [0, 0];

try {
  for (const input of selectedCases) {
    const devices = desktopOnly ? [false] : mobileOnly ? [true] : [false, true];
    for (const mobile of devices) {
      const device = mobile ? "mobile" : "desktop";
      const out = join(outRoot, `${input.name}-${device}`);
      mkdirSync(out, { recursive: true });
      const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 1050 };
      const recordVideo = input.name === "bigben" || process.argv.includes("--record-all");
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, acceptDownloads: true,
        ...(recordVideo ? { recordVideo: { dir: out, size: viewport } } : {}) });
      await context.addInitScript(browserClock);
      const page = await context.newPage();
      const video = page.video();
      const checks = [], errors = [], consoleErrors = [], httpErrors = [], unknownRequests = [], requests = [], mediaRequests = [], blockedExternal = [], screenshots = [], servedSourceSHA256 = {};
      let activeInput = input, pointerDown = false, touchPoint = null, blockRawDepth = false;
      const check = (name, condition, evidence) => checks.push({ name, passed: Boolean(condition), ...(evidence === undefined ? {} : { evidence }) });
      const record = { name: input.name, device, viewport, base, baseline, scenario: cancelOnly ? "cancellations-and-fallbacks" : "full-motion-validation", selectedStyle: input.selectedStyle, mode: "frozen-real-asset-replay", newInference: false,
        sourceManifest: localPath(manifestPath), manifestSHA256: fileHash(manifestPath), photo: localPath(input.photo), photoSHA256: input.photoSHA256,
        assetHashes: input.hashes, sourceSHA256: baselineSourceSHA256 || sourceSHA256, workspaceSourceSHA256: sourceSHA256,
        sourceVersionEvidence: "servedSourceSHA256 hashes the actual delivered bundle; workspaceSourceSHA256 describes files on disk at launch. Baseline sourceSHA256 uses the saved baseline source snapshot when available.",
        servedSourceSHA256, api: { job: input.job, depth: input.depth, styles: input.styles },
        versions: { segmenter: input.job.result.model, depth: input.depth.result.model, depthMetadata: input.depth.result.meshDepthMetadata,
          styles: Object.fromEntries(Object.entries(input.styles).map(([key, value]) => [key, { model: value?.result?.model, compositingVersion: value?.result?.compositingVersion, generationVersion: value?.result?.metrics?.generationVersion, modelRevision: value?.result?.metrics?.modelRevision, seed: value?.result?.metrics?.seed }])) },
        checks, screenshots, errors, consoleErrors, httpErrors, unknownRequests, requests, mediaRequests, blockedExternal,
        timingEvidence: "Natural hold samples/video run with native timestamps. Matching-camera screenshots inject a browser-only rAF clock, slow natural motion near the requested camera crossing, and freeze after a rendered frame; product camera state is never assigned.",
      };
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
      page.on("response", async response => {
        if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
        if (/\.(?:js|tsx?|css)(?:\?|$)/.test(response.url())) {
          try { servedSourceSHA256[new URL(response.url()).pathname] = sha(await response.body()); } catch { /* Aborted resource has no body. */ }
        }
      });
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url()), path = decodeURIComponent(url.pathname);
        if (url.origin !== baseOrigin) {
          blockedExternal.push({ url: url.href, method: request.method() });
          await route.fulfill({ status: 200, contentType: path.endsWith(".css") || url.hostname === "fonts.googleapis.com" ? "text/css" : "application/octet-stream", body: "" });
          return;
        }
        if (path.startsWith("/api/")) {
          requests.push({ path, method: request.method(), time: Date.now() });
          let response;
          if (path === "/api/jobs" && request.method() === "POST") response = { id: activeInput.id };
          else if (path === `/api/jobs/${activeInput.id}` && request.method() === "GET") response = activeInput.job;
          else if (path === "/api/depth" && request.method() === "POST") response = { id: activeInput.id };
          else if (path === `/api/depth/${activeInput.id}` && request.method() === "GET") response = activeInput.depth;
          else if (path === "/api/restyle" && request.method() === "POST") {
            const style = request.postDataJSON().style;
            if (activeInput.styles[style]) response = { id: activeInput.id, style };
          } else if (path.startsWith(`/api/restyle/${activeInput.id}/`) && request.method() === "GET") response = activeInput.styles[path.split("/").at(-1)];
          if (!response) unknownRequests.push({ path, method: request.method() });
          await route.fulfill({ status: response ? 200 : 400, contentType: "application/json", body: JSON.stringify(response || { detail: "Frozen real-asset replay has no captured response; inference is blocked." }) });
          return;
        }
        if (path.startsWith("/media/")) {
          const saved = media.get(url.pathname);
          if (blockRawDepth && path === activeInput.depth.result.meshDepthUrl) {
            mediaRequests.push({ path, deliberatelyAborted: true, reason: "Missing-raw-depth fallback scenario" });
            await route.abort("failed");
            return;
          }
          mediaRequests.push({ path, sha256: saved?.sha256, file: saved ? localPath(saved.path) : null });
          if (!saved) unknownRequests.push({ path, method: request.method() });
          await route.fulfill({ status: saved ? 200 : 404, contentType: saved?.contentType || "text/plain", body: saved?.body || "Uncaptured media blocked." });
          return;
        }
        await route.continue();
      });
      const touch = mobile ? await context.newCDPSession(page) : null;
      async function press() {
        await page.locator(".photo-stage").scrollIntoViewIfNeeded();
        const box = await page.locator(".photo-stage").boundingBox(); assert(box, "Missing photo-stage bounds");
        touchPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
        else { await page.mouse.move(touchPoint.x, touchPoint.y); await page.mouse.down(); }
        pointerDown = true;
      }
      async function release(cancel = false) {
        if (touch) await touch.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
        else {
          if (cancel) await page.locator(".photo-stage").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", isPrimary: true });
          await page.mouse.up();
        }
        pointerDown = false;
      }
      async function capture(name, frozen = false) {
        await page.locator(".photo-stage").scrollIntoViewIfNeeded();
        if (!frozen) await page.evaluate(() => window.__depthEvidence.freeze());
        const before = await geometry(page), box = await page.locator(".photo-stage").boundingBox(); assert(box);
        const path = join(out, `${name}.png`);
        await page.screenshot({ path, clip: box });
        const after = await geometry(page);
        check(`${name}: stable camera during screenshot`, before.cameraX === after.cameraX && before.subjectUrl === after.subjectUrl, { before: before.cameraX, after: after.cameraX });
        screenshots.push({ name, file: `${name}.png`, sha256: fileHash(path), geometry: after });
        if (!frozen) await page.evaluate(() => window.__depthEvidence.resume());
        return after;
      }
      async function naturalHold(prefix, expectedMotion) {
        const rest = await capture(`${prefix}-rest`), apiCount = requests.length;
        if (cancelOnly) return { rest, samples: [], observedRange: [0, 0], skipped: "--cancel-only omits the long motion trajectory." };
        await page.evaluate(() => window.__depthEvidence.sample());
        await press();
        let left = null, right = null, previous = 0;
        const started = Date.now();
        while (Date.now() - started < holdMilliseconds) {
          await page.waitForTimeout(80);
          const current = await geometry(page);
          if (!right && current.cameraX > 0.006 && current.cameraX > previous) right = await capture(`${prefix}-hold-right`);
          if (!left && current.cameraX < -0.006 && current.cameraX < previous) left = await capture(`${prefix}-hold-left`);
          previous = current.cameraX;
        }
        if (!right) right = await capture(`${prefix}-hold-right`);
        if (!left) left = await capture(`${prefix}-hold-left`);
        const samples = await page.evaluate(() => window.__depthEvidence.stopSample());
        const observedRange = range(samples);
        const during = await geometry(page);
        await release(); await settled(page);
        const released = await capture(`${prefix}-release`);
        check(`${prefix}: expected motion`, expectedMotion ? observedRange[1] - observedRange[0] > 0.003 : observedRange.every(value => Math.abs(value) <= 0.0001), { expectedMotion, observedRange });
        check(`${prefix}: no API requests during hold`, requests.length === apiCount, { before: apiCount, after: requests.length });
        check(`${prefix}: release settles`, !released.awake && Math.abs(released.cameraX) <= 0.0001 && released.wake <= 0.0002, released);
        return { rest, left, right, during, released, samples, observedRange, noApiRequestsDuringHold: requests.length === apiCount };
      }
      async function matchingCamera(prefix) {
        if (cancelOnly) return {};
        const views = {};
        for (const [name, target] of [["right", cameraTarget], ["left", -cameraTarget]]) {
          await settled(page);
          await page.evaluate(target => window.__depthEvidence.arm(target), target);
          await press();
          try {
            await page.waitForFunction(() => window.__depthEvidence.state.frozen, null, { timeout: 18000, polling: 25 });
            views[name] = { ...await page.evaluate(() => window.__depthEvidence.state.captured), geometry: await capture(`${prefix}-camera-${name}`, true) };
            check(`${prefix}: matching ${name} camera`, Math.abs(views[name].error) <= 0.0004, views[name]);
          } catch (error) {
            const current = await geometry(page);
            views[name] = { unavailable: true, requested: target, observed: current.cameraX, reason: "Natural safety-capped trajectory did not reach the requested camera within 18 seconds." };
          } finally {
            await page.evaluate(() => window.__depthEvidence.resume());
            await release(); await settled(page);
          }
        }
        return views;
      }
      try {
        await page.goto(base, { waitUntil: "networkidle", timeout: 30000 });
        await page.locator("input[type=file]").setInputFiles(input.photo);
        await ready(page, input.job.result.subjectUrl, !baseline);
        record.upload = await naturalHold("upload", !baseline);
        check("upload: original subject resource", record.upload.rest.subjectUrl === input.job.result.subjectUrl);
        check("upload: subject geometry", baseline || record.upload.rest.stageData.subjectGeometry === "depth-mesh", record.upload.rest.stageData);
        if (!baseline) record.uploadMatchingCamera = await matchingCamera("upload");

        await page.getByRole("button", { name: styleLabels[input.selectedStyle], exact: false }).click();
        await page.getByRole("button", { name: "Generate background", exact: true }).click();
        await ready(page, input.styles[input.selectedStyle].result.subjectUrl, !baseline);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(out, "ui-after.png"), fullPage: true });
        const pngRest = await download(page, join(out, "export-rest.png"));
        record.after = await naturalHold("after", true);
        record.afterMatchingCamera = await matchingCamera("after");
        const apiCount = requests.length;
        await press(); await page.waitForTimeout(700);
        const pngHold = await download(page, join(out, "export-hold.png"));
        record.exportSHA256 = pngRest; record.holdExportSHA256 = pngHold;
        check("PNG export bytes identical during hold", pngRest === pngHold, { rest: pngRest, hold: pngHold });
        check("PNG hold/export made no API request", requests.length === apiCount);
        await release(); await settled(page);

        const afterRest = record.after.rest;
        check("After: subject above bars", Number(afterRest.layers.subjectMesh?.zIndex || afterRest.layers.subject?.zIndex) > Number(afterRest.bars.top?.zIndex), afterRest.layers);
        check("After: background below bars", Number(afterRest.layers.background?.zIndex) < Number(afterRest.bars.top?.zIndex), afterRest.layers);
        check("After: letterbox heights are 13%", Math.abs(afterRest.bars.top.height / afterRest.height - 0.13) < 0.002 && Math.abs(afterRest.bars.bottom.height / afterRest.height - 0.13) < 0.002, afterRest.bars);
        check("After: subject geometry", baseline || afterRest.stageData.subjectGeometry === "depth-mesh", afterRest.stageData);
        check("After: subject uses cached style texture", afterRest.subjectUrl === input.styles[input.selectedStyle].result.subjectUrl);

        await page.getByRole("button", { name: "View before", exact: true }).click();
        await ready(page, input.job.result.subjectUrl, !baseline);
        record.before = await capture("before-rest");
        const beforeApiCount = requests.length;
        await press(); await page.waitForTimeout(700);
        record.beforeHold = await capture("before-hold");
        check("Before comparison stays static", !record.beforeHold.awake && !record.beforeHold.interactive && Math.abs(record.beforeHold.cameraX) <= 0.0001, record.beforeHold);
        check("Before hold made no API request", requests.length === beforeApiCount);
        await release(); await settled(page);
        await page.getByRole("button", { name: "View after", exact: true }).click();
        await ready(page, input.styles[input.selectedStyle].result.subjectUrl, !baseline);

        record.cancellations = {};
        for (const reason of ["pointercancel", "pointerleave", "blur"]) {
          await press(); await page.waitForTimeout(500);
          const held = await geometry(page);
          let outside = null;
          if (reason === "pointercancel") await release(true);
          else if (reason === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
          else {
            const box = held.rect;
            outside = [
              { x: box.x + box.width / 2, y: box.y + box.height + 10 },
              { x: box.x + box.width / 2, y: box.y - 10 },
              { x: box.x - 10, y: box.y + box.height / 2 },
              { x: box.x + box.width + 10, y: box.y + box.height / 2 },
            ].find(point => point.x >= 1 && point.x < viewport.width - 1 && point.y >= 1 && point.y < viewport.height - 1);
            assert(outside, "No viewport point outside the photo is available");
            check("pointerleave: test point is outside stage", outside.x < box.x || outside.x > box.x + box.width || outside.y < box.y || outside.y > box.y + box.height, { outside, box });
            if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [outside] });
            else await page.mouse.move(outside.x, outside.y);
          }
          let timeout = null;
          try { await settled(page); } catch (error) { timeout = error.message; }
          const stopped = await capture(`cancel-${reason}${timeout ? "-failed" : ""}`);
          record.cancellations[reason] = { held, stopped, timeout, outsideCoordinates: outside };
          check(`${reason}: stops and settles`, held.awake && !stopped.awake && Math.abs(stopped.cameraX) <= 0.0001, { held: held.awake, stopped, timeout });
          if (pointerDown) await release();
          if (timeout) { await settled(page); record.cancellations[reason].afterForcedRelease = await capture(`cancel-${reason}-recovered`); }
        }

        const otherStyle = Object.keys(input.styles).find(style => style !== input.selectedStyle) || "dreamy-pink";
        await press(); await page.waitForTimeout(500);
        await page.getByRole("button", { name: styleLabels[otherStyle], exact: false }).evaluate(button => button.click());
        await ready(page, input.job.result.subjectUrl, !baseline);
        record.styleSwitch = await capture("style-change-cancel");
        check("Style change cancels prior hold", !record.styleSwitch.awake && Math.abs(record.styleSwitch.cameraX) <= 0.0001, record.styleSwitch);
        check("Style change restores original resource", record.styleSwitch.subjectUrl === input.job.result.subjectUrl);
        await release();
        if (input.styles[otherStyle]) {
          await page.getByRole("button", { name: "Generate background", exact: true }).click();
          await ready(page, input.styles[otherStyle].result.subjectUrl, !baseline);
          record.otherStyle = await naturalHold(`style-${otherStyle}`, true);
          check("Other cached style attaches its subject", record.otherStyle.rest.subjectUrl === input.styles[otherStyle].result.subjectUrl);
        }
        await page.getByRole("button", { name: styleLabels[input.selectedStyle], exact: false }).click();
        await ready(page, input.styles[input.selectedStyle].result.subjectUrl, !baseline);

        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.waitForFunction(() => !document.querySelector(".photo-stage")?.classList.contains("spatial-ready"));
        await settled(page); await press(); await page.waitForTimeout(700);
        record.reducedMotion = await capture("reduced-motion-hold");
        check("Reduced motion stays static", !record.reducedMotion.awake && Math.abs(record.reducedMotion.cameraX) <= 0.0001 && !record.reducedMotion.interactive, record.reducedMotion);
        await release();
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.locator(".photo-stage.spatial-ready").waitFor();

        const alternate = cases.find(value => value.id !== input.id) || input;
        await press(); await page.waitForTimeout(500);
        activeInput = alternate;
        await page.locator("input[type=file]").setInputFiles(alternate.photo);
        await ready(page, alternate.job.result.subjectUrl, !baseline);
        record.reupload = await capture("reupload-cancel");
        check("Reupload cancels prior hold", !record.reupload.awake && Math.abs(record.reupload.cameraX) <= 0.0001, record.reupload);
        check("Reupload attaches new original resource", record.reupload.subjectUrl === alternate.job.result.subjectUrl && !record.reupload.subjectUrl.includes("/styles/"), { alternate: alternate.name, geometry: record.reupload });
        await release();
        record.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        check("No horizontal overflow", record.overflow <= 1, record.overflow);
        check("No page errors", errors.length === 0, errors);
        check("No console errors", consoleErrors.length === 0, consoleErrors);
        check("No HTTP errors", httpErrors.length === 0, httpErrors);
        check("Only captured APIs and assets used", unknownRequests.length === 0, unknownRequests);
        if (!baseline && input.name === "bigben") {
          record.faults = {};
          const errorCount = errors.length, consoleCount = consoleErrors.length;
          await press(); await page.waitForTimeout(500);
          record.faults.contextLostBefore = await geometry(page);
          record.faults.contextLostTriggered = await page.locator(".subject-depth-layer canvas").evaluate(canvas => {
            const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
            const extension = gl?.getExtension("WEBGL_lose_context");
            if (!extension) return false;
            extension.loseContext();
            return true;
          });
          await page.waitForTimeout(1200);
          record.faults.contextLost = await capture("fault-context-lost");
          record.faults.contextLostNotice = await page.locator("body").innerText();
          const subjectMeshCanvas = record.faults.contextLost.canvases.find(canvas => canvas.parentClass === "subject-depth-layer");
          check("Lost WebGL context restores visible subject", record.faults.contextLostTriggered && record.faults.contextLost.layers.subject.visibility === "visible" && record.faults.contextLost.stageData.subjectGeometry !== "depth-mesh", record.faults.contextLost);
          check("Lost WebGL context hides mesh canvas", !subjectMeshCanvas || record.faults.contextLost.layers.subjectMesh?.display === "none" || subjectMeshCanvas.visibility === "hidden", record.faults.contextLost);
          check("Lost WebGL context stops active interaction", !record.faults.contextLost.awake && !record.faults.contextLost.interactive, record.faults.contextLost);
          check("Lost WebGL context explains fallback", /rendering was interrupted|restore motion|spatial.*unavailable|static preview available/i.test(record.faults.contextLostNotice), record.faults.contextLostNotice);
          await release();

          activeInput = input;
          await page.locator("input[type=file]").setInputFiles(input.photo);
          await ready(page, input.job.result.subjectUrl, true);
          await press(); await page.waitForTimeout(500);
          record.faults.backgroundContextLostBefore = await geometry(page);
          record.faults.backgroundContextLostTriggered = await page.locator(".spatial-canvas canvas").evaluate(canvas => {
            const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
            const extension = gl?.getExtension("WEBGL_lose_context");
            if (!extension) return false;
            extension.loseContext();
            return true;
          });
          await page.waitForTimeout(1200);
          record.faults.backgroundContextLost = await capture("fault-background-context-lost");
          record.faults.backgroundContextLostNotice = await page.locator("body").innerText();
          const lostBackgroundCanvas = record.faults.backgroundContextLost.canvases.find(canvas => canvas.parentClass === "spatial-canvas");
          check("Lost background context restores visible subject", record.faults.backgroundContextLostTriggered && record.faults.backgroundContextLost.layers.subject.visibility === "visible" && record.faults.backgroundContextLost.stageData.subjectGeometry !== "depth-mesh", record.faults.backgroundContextLost);
          check("Lost background context hides canvas", !lostBackgroundCanvas || lostBackgroundCanvas.visibility === "hidden" || lostBackgroundCanvas.display === "none", record.faults.backgroundContextLost);
          check("Lost background context stops active interaction", !record.faults.backgroundContextLost.awake && !record.faults.backgroundContextLost.interactive, record.faults.backgroundContextLost);
          check("Lost background context explains fallback", /rendering was interrupted|restore motion|spatial.*unavailable|static preview available/i.test(record.faults.backgroundContextLostNotice), record.faults.backgroundContextLostNotice);
          await release();

          blockRawDepth = true;
          await page.locator("input[type=file]").setInputFiles(input.photo);
          await page.getByText("YOUR FRAME IS READY", { exact: true }).waitFor({ timeout: 30000 });
          await page.waitForFunction(expected => {
            const stage = document.querySelector(".photo-stage");
            return stage?.querySelector(".subject-layer img")?.getAttribute("src") === expected &&
              stage?.querySelector(".spatial-canvas canvas")?.style.visibility === "visible";
          }, input.job.result.subjectUrl, { timeout: 30000 });
          await page.waitForTimeout(400);
          record.faults.missingRaw = await capture("fault-missing-raw");
          record.faults.missingRawNotice = await page.locator("body").innerText();
          check("Missing raw depth preserves visible subject", record.faults.missingRaw.layers.subject.visibility === "visible" && record.faults.missingRaw.stageData.subjectGeometry !== "depth-mesh", record.faults.missingRaw);
          check("Missing raw depth explains fallback", /local depth.*unavailable|spatial.*unavailable|static preview available|flat.*preview/i.test(record.faults.missingRawNotice), record.faults.missingRawNotice);
          record.faults.consoleErrors = consoleErrors.slice(consoleCount);
          record.faults.pageErrors = errors.slice(errorCount);
          check("Fault scenarios cause no JavaScript error", record.faults.pageErrors.length === 0, record.faults.pageErrors);
          blockRawDepth = false;
        }
        record.completed = true;
      } catch (error) {
        record.completed = false; record.failure = error.stack || error.message;
        check("Harness completed scenario", false, error.message);
        await page.evaluate(() => window.__depthEvidence?.resume()).catch(() => {});
        await page.screenshot({ path: join(out, "failure.png"), fullPage: true }).catch(() => {});
        record.failureBody = await page.locator("body").innerText().catch(() => "");
      } finally {
        if (pointerDown) await release().catch(() => {});
        await context.close();
        if (video) {
          const videoPath = await video.path();
          const target = join(out, "hold-demo.webm");
          if (existsSync(target)) { record.video = localPath(videoPath); }
          else { renameSync(videoPath, target); record.video = localPath(target); }
        }
        record.screenshotHashes = Object.fromEntries(readdirSync(out).filter(file => file.endsWith(".png")).map(file => [file, fileHash(join(out, file))]));
        record.passed = record.completed && checks.every(value => value.passed);
        writeFileSync(join(out, "results.json"), JSON.stringify(record, null, 2));
        records.push(record);
        writeFileSync(join(outRoot, "results.json"), JSON.stringify(records, null, 2));
        console.log(JSON.stringify({ name: input.name, device, baseline, passed: record.passed, uploadCameraRange: record.upload?.observedRange,
          afterCameraRange: record.after?.observedRange, matchingCamera: record.afterMatchingCamera ? Object.fromEntries(Object.entries(record.afterMatchingCamera).map(([key, value]) => [key, { cameraX: value.cameraX, wake: value.wake, error: value.error, unavailable: value.unavailable }])) : null,
          failedChecks: checks.filter(value => !value.passed).map(value => value.name), failure: record.failure, out: localPath(out) }));
      }
    }
  }
  if (comparePath) {
    const previous = JSON.parse(readFileSync(resolve(comparePath), "utf8"));
    const comparisons = records.map(record => {
      const old = previous.find(value => value.name === record.name && value.device === record.device);
      if (!old) return { name: record.name, device: record.device, available: false };
      const oldStyle = old.api.styles[old.selectedStyle || "cinematic-night"]?.result || old.api.styles["cinematic-night"]?.result;
      const newStyle = record.api.styles[record.selectedStyle || "cinematic-night"]?.result || record.api.styles["cinematic-night"]?.result;
      return { name: record.name, device: record.device, available: true,
        identicalPhotoBytes: old.photoSHA256 === record.photoSHA256, identicalAssetHashes: JSON.stringify(old.assetHashes) === JSON.stringify(record.assetHashes),
        identicalManifest: old.manifestSHA256 === record.manifestSHA256,
        originalUploadRange: old.upload?.observedRange, newUploadRange: record.upload?.observedRange,
        sourceVersions: { baseline: old.servedSourceSHA256, after: record.servedSourceSHA256 },
        styleResources: { baseline: oldStyle, after: newStyle },
        centeredComposition: Object.fromEntries(["width", "height", "zoom", "shiftX", "shiftY"].map(key => [key, { baseline: old.after?.rest?.[key], after: record.after?.rest?.[key], identical: old.after?.rest?.[key] === record.after?.rest?.[key] }])),
        matchingCamera: Object.fromEntries(["left", "right"].map(key => [key, { baseline: old.afterMatchingCamera?.[key], after: record.afterMatchingCamera?.[key],
          cameraDifference: old.afterMatchingCamera?.[key]?.cameraX === undefined || record.afterMatchingCamera?.[key]?.cameraX === undefined ? null : record.afterMatchingCamera[key].cameraX - old.afterMatchingCamera[key].cameraX,
          wakeDifference: old.afterMatchingCamera?.[key]?.wake === undefined || record.afterMatchingCamera?.[key]?.wake === undefined ? null : record.afterMatchingCamera[key].wake - old.afterMatchingCamera[key].wake }])),
      };
    });
    writeFileSync(join(outRoot, "baseline-comparison.json"), JSON.stringify(comparisons, null, 2));
  }
} finally {
  await browser.close();
}
const summary = { mode: "frozen-real-asset-replay", newInference: false, baseline, base, sourceManifest: localPath(manifestPath),
  cases: records.map(record => ({ name: record.name, device: record.device, passed: record.passed, checks: record.checks.length, failures: record.checks.filter(value => !value.passed).map(value => value.name), video: record.video })),
  passed: records.every(record => record.passed), completedAt: new Date().toISOString() };
writeFileSync(join(outRoot, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (!summary.passed) process.exitCode = 1;
