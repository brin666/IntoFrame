// Frozen real-asset browser validation of gentle autonomous motion and drag takeover.
// No API reaches an inference service; media is fulfilled from checked local files.
// Screenshots and JSON only. This harness never records or uploads a video.
// node scripts/drag-motion-browser.mjs --base http://127.0.0.1:5190 --include bigben --out screenshots/drag-motion-fix/pilot
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  assert(value && !value.startsWith("--"), `--${name} requires a value`);
  return value;
}
if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/drag-motion-browser.mjs [--base URL] [--manifest PATH] [--out DIR] [--include bigben,dog,paris] [--desktop-only | --mobile-only] [--skip-matched]");
  process.exit(0);
}
const workspace = resolve(".");
const mediaRoot = resolve("backend/data");
const manifestPath = resolve(argument("manifest", "screenshots/depth-motion-fix/manifest.json"));
const outRoot = resolve(argument("out", "screenshots/drag-motion-fix/browser"));
const base = argument("base", "http://127.0.0.1:5190").replace(/\/$/, "");
const origin = new URL(base).origin;
const include = argument("include", "bigben,dog,paris").split(",").map(value => value.trim());
const desktopOnly = process.argv.includes("--desktop-only"), mobileOnly = process.argv.includes("--mobile-only");
assert(!(desktopOnly && mobileOnly), "Choose one device filter");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fileHash = path => sha(readFileSync(path));
const localPath = path => relative(workspace, path).replaceAll("\\", "/");
const styleLabels = { "cinematic-night": "Cinematic Night", "dreamy-pink": "Dreamy Pink", "golden-hour": "Golden Hour" };
const sourceFiles = ["src/App.tsx", "src/SpatialFrameScene.tsx", "src/sceneMotion.ts", "src/depthGeometry.ts", "src/parallax.ts", "src/styles.css", "src/exportFrame.ts", "scripts/drag-motion-browser.mjs"];
const sourceSHA256 = Object.fromEntries(sourceFiles.filter(file => existsSync(file)).map(file => [file, fileHash(file)]));
const contentTypes = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".bin": "application/octet-stream", ".json": "application/json" };
function inside(path, root) {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}
function urls(value, found = new Set()) {
  if (typeof value === "string" && value.startsWith("/media/")) found.add(new URL(value, base).pathname);
  else if (Array.isArray(value)) value.forEach(item => urls(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach(item => urls(item, found));
  return found;
}
const media = new Map();
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const cases = manifest.cases.map(input => {
  const id = input.jobId || input.job?.result?.id;
  assert(id && input.job?.result && input.depth?.result, "Captured job and depth API results are required");
  assert(/^[a-z0-9_-]+$/i.test(input.name), "Case name must be a safe directory name");
  const assetDir = resolve(input.assetDir || join(mediaRoot, id));
  const hashes = {};
  for (const url of urls([input.job, input.depth, input.styles])) {
    const path = resolve(mediaRoot, decodeURIComponent(url.slice("/media/".length)));
    assert(inside(path, mediaRoot) && existsSync(path), `${input.name}: missing or unsafe cached media ${url}`);
    const body = readFileSync(path), digest = sha(body);
    const key = inside(path, assetDir) ? relative(assetDir, path).replaceAll("\\", "/") : localPath(path);
    if (input.files?.[key]) assert.equal(digest, input.files[key], `${input.name}: frozen media bytes changed`);
    hashes[key] = digest;
    media.set(url, { path, body, sha256: digest, contentType: contentTypes[extname(path)] || "application/octet-stream" });
  }
  const photo = resolve(input.photo || join(assetDir, "source.webp"));
  assert(inside(photo, workspace) && existsSync(photo), `${input.name}: photo must be a local workspace file`);
  return { ...input, id, assetDir, hashes, photo, photoSHA256: fileHash(photo), selectedStyle: input.selectedStyle || "cinematic-night" };
});
const selected = cases.filter(input => include.includes(input.name));
assert(selected.length, "No cases matched --include");
mkdirSync(outRoot, { recursive: true });

// Observes actual browser frames. It does not intercept rAF or assign camera state.
function installObserver() {
  const events = [];
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) {
    document.addEventListener(type, event => {
      const stage = document.querySelector(".photo-stage");
      if (!stage || (event.target !== stage && !stage.contains(event.target))) return;
      events.push({ type, pointerId: event.pointerId, pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY,
        trusted: event.isTrusted, time: performance.now(), stage: { x: stage.getBoundingClientRect().x, y: stage.getBoundingClientRect().y, width: stage.clientWidth, height: stage.clientHeight } });
      if (events.length > 500) events.shift();
    }, true);
  }
  let sampling = false, started = 0, samples = [];
  function tick(now) {
    if (sampling) {
      const stage = document.querySelector(".photo-stage");
      if (stage) samples.push({ time: now, milliseconds: now - started, cameraX: Number(stage.dataset.cameraX), cameraTargetX: Number(stage.dataset.cameraTargetX),
        wake: Number(stage.style.getPropertyValue("--wake") || 0), scale: Number(stage.style.getPropertyValue("--subject-parallax-scale") || 1),
        mode: stage.dataset.motionMode, leftTravel: Number(stage.dataset.leftTravel), rightTravel: Number(stage.dataset.rightTravel),
        autoTravelRatio: Number(stage.dataset.autoTravelRatio), awake: stage.classList.contains("is-awake"), scrollY: window.scrollY });
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.__dragEvidence = { events,
    start() { samples = []; started = performance.now(); sampling = true; },
    stop() { sampling = false; return samples; },
  };
}
function span(samples, field = "cameraX") {
  const values = samples.map(sample => sample[field]).filter(Number.isFinite);
  return values.length ? [Math.min(...values), Math.max(...values)] : [null, null];
}
function width(values) { return values[0] === null ? 0 : values[1] - values[0]; }
async function geometry(page) {
  return page.locator(".photo-stage").evaluate(stage => {
    const rect = stage.getBoundingClientRect(), style = element => element ? { zIndex: getComputedStyle(element).zIndex, visibility: getComputedStyle(element).visibility, display: getComputedStyle(element).display } : null;
    return { cameraX: Number(stage.dataset.cameraX), cameraTargetX: Number(stage.dataset.cameraTargetX), mode: stage.dataset.motionMode,
      leftTravel: Number(stage.dataset.leftTravel), rightTravel: Number(stage.dataset.rightTravel), autoTravelRatio: Number(stage.dataset.autoTravelRatio),
      wake: Number(stage.style.getPropertyValue("--wake") || 0), scale: Number(stage.style.getPropertyValue("--subject-parallax-scale") || 1),
      photoZoom: Number(stage.style.getPropertyValue("--photo-zoom") || 1), photoShiftX: stage.style.getPropertyValue("--photo-x") || "0px", photoShiftY: stage.style.getPropertyValue("--photo-y") || "0px",
      width: stage.clientWidth, height: stage.clientHeight, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      interactive: stage.classList.contains("spatial-ready"), awake: stage.classList.contains("is-awake"), touchAction: getComputedStyle(stage).touchAction,
      subjectUrl: stage.querySelector(".subject-layer img")?.getAttribute("src"), backgroundUrl: stage.querySelector(".background-content > img")?.getAttribute("src"),
      stageData: { ...stage.dataset }, hostData: { ...stage.querySelector(".spatial-canvas")?.dataset },
      canvases: [...stage.querySelectorAll("canvas")].map(canvas => ({ width: canvas.width, height: canvas.height, data: { ...canvas.dataset }, style: style(canvas), parentClass: canvas.parentElement.className })),
      layers: { subject: style(stage.querySelector(".subject-layer")), mesh: style(stage.querySelector(".subject-depth-layer")), background: style(stage.querySelector(".background-layer")), bars: style(stage.querySelector(".letterbox-top")) },
      images: [...stage.querySelectorAll("img")].map(image => ({ src: image.getAttribute("src"), complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })),
      scrollY: window.scrollY,
    };
  });
}
async function ready(page, input, style = null) {
  const expectedSubject = style ? input.styles[style].result.subjectUrl : input.job.result.subjectUrl;
  const expectedBackground = style ? input.styles[style].result.renderBackgroundUrl : input.depth.result.backgroundUrl;
  const expectedMode = style ? "sky-layers" : "photo-depth";
  await page.getByText("YOUR FRAME IS READY", { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForFunction(expected => {
    const stage = document.querySelector(".photo-stage"), canvas = stage?.querySelector(".spatial-canvas canvas");
    return stage?.querySelector(".subject-layer img")?.getAttribute("src") === expected.subject &&
      stage?.querySelector(".background-content > img")?.getAttribute("src") === expected.background &&
      stage?.dataset.subjectGeometry === "depth-mesh" && canvas?.style.visibility === "visible" &&
      canvas?.dataset.backgroundUrl === expected.background && stage.querySelector(".spatial-canvas")?.dataset.backgroundMode === expected.mode &&
      stage.dataset.motionMode !== undefined && Number.isFinite(Number(stage.dataset.cameraX)) &&
      Number.isFinite(Number(stage.dataset.cameraTargetX)) && Number.isFinite(Number(stage.dataset.leftTravel)) && Number.isFinite(Number(stage.dataset.rightTravel)) &&
      [...stage.querySelectorAll("img")].every(image => image.complete && image.naturalWidth > 0);
  }, { subject: expectedSubject, background: expectedBackground, mode: expectedMode }, { timeout: 45000 });
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-webgl"] });
const records = [];
try {
  for (const input of selected) {
    for (const mobile of desktopOnly ? [false] : mobileOnly ? [true] : [false, true]) {
      const device = mobile ? "mobile" : "desktop", out = join(outRoot, `${input.name}-${device}`);
      mkdirSync(out, { recursive: true });
      const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 1050 };
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
      await context.addInitScript(installObserver);
      const page = await context.newPage(), touch = mobile ? await context.newCDPSession(page) : null;
      const checks = [], errors = [], consoleErrors = [], httpErrors = [], unknownRequests = [], requests = [], mediaRequests = [], blockedExternal = [], screenshots = [], servedSourceSHA256 = {};
      let activeInput = input, down = false, pressPoint = null;
      const check = (name, passed, evidence) => checks.push({ name, passed: Boolean(passed), ...(evidence === undefined ? {} : { evidence }) });
      const record = { name: input.name, device, viewport, base, mode: "frozen-real-asset-replay", newInference: false, recordings: false,
        sourceManifest: localPath(manifestPath), manifestSHA256: fileHash(manifestPath), photo: localPath(input.photo), photoSHA256: input.photoSHA256,
        assetHashes: input.hashes, sourceSHA256, servedSourceSHA256,
        api: { job: input.job, depth: input.depth, styles: input.styles }, checks, screenshots, errors, consoleErrors, httpErrors, unknownRequests, requests, mediaRequests, blockedExternal,
        observation: "Native browser requestAnimationFrame timestamps and native mouse/CDP touch gestures. Camera state is only observed; no product hooks, clock overrides, recordings or uploads.",
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
        if (url.origin !== origin) {
          blockedExternal.push({ url: url.href, method: request.method() });
          await route.fulfill({ status: 200, contentType: url.hostname === "fonts.googleapis.com" || path.endsWith(".css") ? "text/css" : "application/octet-stream", body: "" });
          return;
        }
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
          await route.fulfill({ status: body ? 200 : 400, contentType: "application/json", body: JSON.stringify(body || { detail: "Uncaptured API blocked; this test never runs inference." }) });
          return;
        }
        if (path.startsWith("/media/")) {
          const saved = media.get(url.pathname);
          mediaRequests.push({ path, sha256: saved?.sha256, file: saved ? localPath(saved.path) : null });
          if (!saved) unknownRequests.push({ path, method: request.method() });
          await route.fulfill({ status: saved ? 200 : 404, contentType: saved?.contentType || "text/plain", body: saved?.body || "Uncaptured media blocked." });
          return;
        }
        await route.continue();
      });
      async function sample(milliseconds) {
        await page.evaluate(() => window.__dragEvidence.start());
        await page.waitForTimeout(milliseconds);
        return page.evaluate(() => window.__dragEvidence.stop());
      }
      async function capture(name) {
        await page.locator(".photo-stage").scrollIntoViewIfNeeded();
        const before = await geometry(page), clip = await page.locator(".photo-stage").boundingBox(); assert(clip);
        const path = join(out, `${name}.png`);
        await page.screenshot({ path, clip });
        const after = await geometry(page);
        screenshots.push({ name, file: `${name}.png`, sha256: fileHash(path), before, after });
        return after;
      }
      async function press() {
        await page.locator(".photo-stage").scrollIntoViewIfNeeded();
        const box = await page.locator(".photo-stage").boundingBox(); assert(box);
        pressPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height };
        if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pressPoint.x, y: pressPoint.y }] });
        else { await page.mouse.move(pressPoint.x, pressPoint.y); await page.mouse.down(); }
        down = true;
      }
      async function move(point, steps = 6) {
        if (touch) {
          const events = await page.evaluate(() => window.__dragEvidence.events);
          const last = [...events].reverse().find(event => event.type === "pointermove" || event.type === "pointerdown");
          const from = last ? { x: last.clientX, y: last.clientY } : pressPoint;
          for (let index = 1; index <= steps; index++) {
            await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (point.x - from.x) * index / steps, y: from.y + (point.y - from.y) * index / steps }] });
            await page.waitForTimeout(18);
          }
        } else await page.mouse.move(point.x, point.y, { steps });
      }
      async function release(cancel = false) {
        if (touch) await touch.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
        else {
          if (cancel) {
            const pointerId = await page.evaluate(() => [...window.__dragEvidence.events].reverse().find(event => event.type === "pointerdown")?.pointerId || 1);
            await page.locator(".photo-stage").dispatchEvent("pointercancel", { pointerId, pointerType: "mouse", isPrimary: true });
          }
          await page.mouse.up();
        }
        down = false;
      }
      async function expectAuto() {
        await page.waitForFunction(() => document.querySelector(".photo-stage")?.dataset.motionMode === "autonomous", null, { timeout: 6000 });
      }
      async function expectStatic(name) {
        await page.waitForFunction(() => {
          const stage = document.querySelector(".photo-stage");
          return stage && Math.abs(Number(stage.dataset.cameraX)) <= 0.0001 && Number(stage.style.getPropertyValue("--wake") || 0) <= 0.0002;
        }, null, { timeout: 6000 });
        const values = await sample(450), pose = await capture(name);
        check(`${name}: static camera`, width(span(values)) <= 0.0001 && Math.abs(pose.cameraX) <= 0.0001, { cameraRange: span(values), pose });
        return { pose, samples: values };
      }
      async function download(name) {
        const pending = page.waitForEvent("download", { timeout: 20000 });
        await page.getByRole("button", { name: "Download PNG", exact: true }).evaluate(button => button.click());
        const path = join(out, `${name}.png`);
        await (await pending).saveAs(path);
        return fileHash(path);
      }
      async function exercise(prefix, png = false) {
        await expectAuto();
        const apiCount = requests.length;
        const autoSamples = await sample(3300), auto = await capture(`${prefix}-auto`);
        const autoRange = span(autoSamples);
        check(`${prefix}: default automatic motion`, width(autoRange) > 0.0002 && autoSamples.some(value => value.mode === "autonomous"), { range: autoRange, mode: auto.mode });
        check(`${prefix}: gentle automatic range`, autoSamples.every(value => value.cameraX >= -value.leftTravel * value.autoTravelRatio - 0.0002 && value.cameraX <= value.rightTravel * value.autoTravelRatio + 0.0002), { range: autoRange, leftTravel: auto.leftTravel, rightTravel: auto.rightTravel, ratio: auto.autoTravelRatio });
        check(`${prefix}: native depth subject drawn`, auto.stageData.subjectGeometry === "depth-mesh" && auto.canvases.some(canvas => canvas.parentClass === "subject-depth-layer" && canvas.style.visibility === "visible") && mediaRequests.some(value => value.path === input.depth.result.meshDepthUrl), auto.stageData);
        const restPNG = png ? await download("export-auto") : null;
        await press(); await page.waitForTimeout(350);
        const stationarySamples = await sample(550), stationary = await capture(`${prefix}-pressed-stationary`);
        check(`${prefix}: stationary press stops oscillation`, width(span(stationarySamples)) <= 0.0002 && width(span(stationarySamples, "cameraTargetX")) <= 0.0001 && stationarySamples.every(value => value.mode !== "autonomous"), { cameraRange: span(stationarySamples), targetRange: span(stationarySamples, "cameraTargetX"), mode: stationary.mode });
        check(`${prefix}: stationary press freezes forward pose`, width(span(stationarySamples, "wake")) <= 0.0002 && width(span(stationarySamples, "scale")) <= 0.00005, { wakeRange: span(stationarySamples, "wake"), scaleRange: span(stationarySamples, "scale") });
        await move({ x: pressPoint.x - pressPoint.width * 0.35, y: pressPoint.y }); await page.waitForTimeout(650);
        const left = await capture(`${prefix}-drag-left`);
        check(`${prefix}: finger left moves scene left`, left.cameraTargetX > stationary.cameraTargetX + 0.002 && left.cameraX > stationary.cameraX + 0.002, { stationary: stationary.cameraX, camera: left.cameraX, target: left.cameraTargetX });
        await move({ x: pressPoint.x + pressPoint.width * 0.35, y: pressPoint.y }); await page.waitForTimeout(650);
        const right = await capture(`${prefix}-drag-right`);
        check(`${prefix}: finger right moves scene right`, right.cameraTargetX < stationary.cameraTargetX - 0.002 && right.cameraX < stationary.cameraX - 0.002, { stationary: stationary.cameraX, camera: right.cameraX, target: right.cameraTargetX });
        check(`${prefix}: drag respects both safe bounds`, left.cameraX <= left.rightTravel + 0.0001 && right.cameraX >= -right.leftTravel - 0.0001 && left.cameraTargetX <= left.rightTravel + 0.0001 && right.cameraTargetX >= -right.leftTravel - 0.0001, { left, right });
        const dragPNG = png ? await download("export-drag") : null;
        if (png) check("PNG bytes match during automatic motion and drag", restPNG === dragPNG, { automatic: restPNG, drag: dragPNG });
        await page.evaluate(() => window.__dragEvidence.start());
        const releaseStart = await geometry(page);
        await release(); await page.waitForTimeout(2300);
        const releaseSamples = await page.evaluate(() => window.__dragEvidence.stop());
        const released = await capture(`${prefix}-release-auto`);
        const jumps = releaseSamples.slice(1).map((value, index) => Math.abs(value.cameraX - releaseSamples[index].cameraX));
        const firstJump = releaseSamples.length ? Math.abs(releaseSamples[0].cameraX - releaseStart.cameraX) : Infinity;
        const maximumJump = jumps.length ? Math.max(...jumps) : Infinity;
        check(`${prefix}: smooth release handoff`, firstJump <= 0.0008 && maximumJump <= 0.0025 && releaseSamples.every(value => value.cameraX >= -value.leftTravel - 0.0001 && value.cameraX <= value.rightTravel + 0.0001), { firstJump, maximumJump, initial: releaseStart.cameraX, final: released.cameraX });
        check(`${prefix}: automatic motion resumes`, released.mode === "autonomous" && width(span(releaseSamples.slice(-25))) > 0.00001, { mode: released.mode, lateRange: span(releaseSamples.slice(-25)) });
        check(`${prefix}: motion causes no API request`, requests.length === apiCount, { before: apiCount, after: requests.length });
        return { auto, autoSamples, autoRange, stationary, stationarySamples, left, right, releaseStart, released, releaseSamples, firstJump, maximumJump, exportSHA256: restPNG, dragExportSHA256: dragPNG };
      }
      async function matchedCamera() {
        if (process.argv.includes("--skip-matched")) return { skipped: true };
        const views = {};
        for (const [side, target] of [["left", -0.01989], ["right", 0.01989]]) {
          await expectAuto(); await press(); await page.waitForTimeout(150);
          const anchor = await geometry(page);
          const available = target < anchor.cameraTargetX ? anchor.cameraTargetX + anchor.leftTravel : anchor.rightTravel - anchor.cameraTargetX;
          if (available <= 0 || target < -anchor.leftTravel || target > anchor.rightTravel) {
            views[side] = { unavailable: true, target, leftTravel: anchor.leftTravel, rightTravel: anchor.rightTravel };
          } else {
            const delta = target < anchor.cameraTargetX ? (anchor.cameraTargetX - target) / available / 3 : -(target - anchor.cameraTargetX) / available / 3;
            await move({ x: pressPoint.x + delta * pressPoint.width, y: pressPoint.y });
            await page.waitForTimeout(900);
            const pose = await capture(`after-matched-camera-${side}`);
            views[side] = { target, pointerDeltaFraction: delta, pose, error: pose.cameraX - target };
            check(`matched ${side}: real drag reaches camera`, Math.abs(views[side].error) <= 0.00025, views[side]);
          }
          await release(); await expectAuto();
        }
        return views;
      }
      try {
        await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.locator("input[type=file]").setInputFiles(input.photo);
        await ready(page, input);
        record.original = await exercise("original");
        await page.getByRole("button", { name: styleLabels[input.selectedStyle], exact: false }).click();
        await page.getByRole("button", { name: "Generate background", exact: true }).click();
        await ready(page, input, input.selectedStyle);
        record.after = await exercise("after", true);
        record.matchedCamera = await matchedCamera();
        await page.screenshot({ path: join(out, "ui-after.png"), fullPage: true });
        record.repeated = [];
        for (let index = 0; index < 3; index++) {
          await press();
          await move({ x: pressPoint.x + pressPoint.width * (index % 2 ? -0.15 : 0.15), y: pressPoint.y });
          await page.waitForTimeout(120); await release(); await expectAuto();
          record.repeated.push(await geometry(page));
        }
        check("Repeated drag/release remains responsive", record.repeated.every(value => value.mode === "autonomous" && value.stageData.subjectGeometry === "depth-mesh"), record.repeated);
        await press(); await move({ x: pressPoint.x + pressPoint.width * 0.15, y: pressPoint.y });
        await release(true); await expectAuto();
        record.pointerCancel = await capture("pointer-cancel-auto");
        check("Pointer cancellation returns to automatic motion", record.pointerCancel.mode === "autonomous");
        await press(); await move({ x: pressPoint.x + pressPoint.width * 0.12, y: pressPoint.y });
        const held = await geometry(page), box = held.rect;
        const outside = [{ x: box.x + box.width + 10, y: pressPoint.y }, { x: box.x - 10, y: pressPoint.y }].find(point => point.x >= 1 && point.x < viewport.width - 1 && point.y >= 1 && point.y < viewport.height - 1);
        if (outside) {
          await move(outside); await page.waitForTimeout(350);
          record.pointerLeave = { outside, held: await capture("captured-drag-outside") };
          check("Captured drag outside remains bounded", record.pointerLeave.held.mode === "drag" && record.pointerLeave.held.cameraX >= -record.pointerLeave.held.leftTravel - 0.0001 && record.pointerLeave.held.cameraX <= record.pointerLeave.held.rightTravel + 0.0001, record.pointerLeave);
        } else record.pointerLeave = { skipped: "No horizontal point outside the photo within this viewport." };
        await release(); await expectAuto();
        check("Release after leaving returns to automatic motion", (await geometry(page)).mode === "autonomous");
        await press(); await move({ x: pressPoint.x + pressPoint.width * 0.12, y: pressPoint.y });
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        record.blur = await expectStatic("blur-paused");
        await release(); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expectAuto();
        check("Focus restores automatic motion after blur", (await geometry(page)).mode === "autonomous");
        await page.getByRole("button", { name: "View before", exact: true }).click();
        await ready(page, input);
        record.before = await expectStatic("before-static");
        await press(); await move({ x: pressPoint.x + pressPoint.width * 0.15, y: pressPoint.y });
        record.beforeDrag = await expectStatic("before-drag-static");
        await release();
        await page.getByRole("button", { name: "View after", exact: true }).click(); await ready(page, input, input.selectedStyle); await expectAuto();
        await page.getByRole("button", { name: "View mask", exact: true }).click();
        record.mask = await expectStatic("mask-static");
        await page.getByRole("button", { name: "Hide mask", exact: true }).click(); await expectAuto();
        const otherStyle = Object.keys(input.styles).find(style => style !== input.selectedStyle) || "dreamy-pink";
        await press(); await move({ x: pressPoint.x + pressPoint.width * 0.12, y: pressPoint.y });
        await page.getByRole("button", { name: styleLabels[otherStyle], exact: false }).evaluate(button => button.click());
        await ready(page, input); await expectAuto();
        record.styleSwitch = await capture("style-switch-auto-original");
        check("Style switch cancels drag and restores original automatic scene", record.styleSwitch.mode === "autonomous" && record.styleSwitch.subjectUrl === input.job.result.subjectUrl, record.styleSwitch);
        await release();
        if (input.styles[otherStyle]) {
          await page.getByRole("button", { name: "Generate background", exact: true }).click(); await ready(page, input, otherStyle); await expectAuto();
          record.otherStyle = await capture("cached-other-style-auto");
          check("Other cached style preserves depth mesh", record.otherStyle.stageData.subjectGeometry === "depth-mesh" && record.otherStyle.subjectUrl === input.styles[otherStyle].result.subjectUrl, record.otherStyle);
        }
        await page.getByRole("button", { name: styleLabels[input.selectedStyle], exact: false }).click(); await ready(page, input, input.selectedStyle); await expectAuto();
        await page.emulateMedia({ reducedMotion: "reduce" });
        record.reducedMotion = await expectStatic("reduced-motion-static");
        await press(); await move({ x: pressPoint.x + pressPoint.width * 0.15, y: pressPoint.y });
        record.reducedMotionDrag = await expectStatic("reduced-motion-drag-static");
        check("Reduced motion disables interaction", !record.reducedMotionDrag.pose.interactive && !record.reducedMotionDrag.pose.awake, record.reducedMotionDrag.pose);
        await release(); await page.emulateMedia({ reducedMotion: "no-preference" }); await expectAuto();
        if (mobile) {
          await page.locator(".photo-stage").scrollIntoViewIfNeeded();
          const box = await page.locator(".photo-stage").boundingBox(); assert(box);
          const start = { x: box.x + box.width / 2, y: box.y + box.height * 0.72 };
          const end = { x: start.x + 2, y: Math.max(2, start.y - Math.min(140, box.height * 0.36)) };
          const scrollBefore = await page.evaluate(() => window.scrollY);
          await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] }); down = true;
          for (let index = 1; index <= 8; index++) { await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * index / 8, y: start.y + (end.y - start.y) * index / 8 }] }); await page.waitForTimeout(20); }
          await release(); await page.waitForTimeout(400);
          const scrollAfter = await page.evaluate(() => window.scrollY);
          await expectAuto();
          record.verticalScroll = { start, end, scrollBefore, scrollAfter, delta: scrollAfter - scrollBefore, pose: await capture("touch-vertical-scroll") };
          check("Touch photo allows native vertical page scrolling", record.verticalScroll.delta >= 25 && record.verticalScroll.pose.touchAction.includes("pan-y"), record.verticalScroll);
          check("Vertical scroll does not leave dragging stuck", record.verticalScroll.pose.mode === "autonomous", record.verticalScroll.pose);
        }
        const alternate = cases.find(value => value.id !== input.id) || input;
        await press(); await move({ x: pressPoint.x + pressPoint.width * 0.12, y: pressPoint.y });
        activeInput = alternate;
        await page.locator("input[type=file]").setInputFiles(alternate.photo);
        await ready(page, alternate); await expectAuto();
        record.reupload = await capture("reupload-auto");
        check("Reupload clears old drag and uses its own depth scene", record.reupload.mode === "autonomous" && record.reupload.subjectUrl === alternate.job.result.subjectUrl && record.reupload.stageData.subjectGeometry === "depth-mesh", { alternate: alternate.name, pose: record.reupload });
        await release();
        record.pointerEvents = await page.evaluate(() => window.__dragEvidence.events);
        record.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        check("No horizontal page overflow", record.overflow <= 1, record.overflow);
        check("No JavaScript errors", errors.length === 0, errors);
        check("No console errors", consoleErrors.length === 0, consoleErrors);
        check("No HTTP errors", httpErrors.length === 0, httpErrors);
        check("Only captured APIs and local assets used", unknownRequests.length === 0, unknownRequests);
        record.completed = true;
      } catch (error) {
        record.completed = false; record.failure = error.stack || error.message;
        check("Scenario completed", false, error.message);
        record.failureBody = await page.locator("body").innerText().catch(() => "");
        record.failureGeometry = await geometry(page).catch(() => null);
        record.pointerEvents = await page.evaluate(() => window.__dragEvidence?.events || []).catch(() => []);
        await page.screenshot({ path: join(out, "failure.png"), fullPage: true }).catch(() => {});
      } finally {
        if (down) await release().catch(() => {});
        await context.close();
        record.passed = record.completed && checks.every(value => value.passed);
        record.screenshotHashes = Object.fromEntries(readdirSync(out).filter(file => file.endsWith(".png")).map(file => [file, fileHash(join(out, file))]));
        writeFileSync(join(out, "results.json"), JSON.stringify(record, null, 2));
        records.push(record); writeFileSync(join(outRoot, "results.json"), JSON.stringify(records, null, 2));
        console.log(JSON.stringify({ name: input.name, device, passed: record.passed, checks: checks.length, failures: checks.filter(value => !value.passed).map(value => value.name),
          originalAutoRange: record.original?.autoRange, afterAutoRange: record.after?.autoRange, releaseMaximumJump: record.after?.maximumJump, verticalScrollPixels: record.verticalScroll?.delta, failure: record.failure, out: localPath(out) }));
      }
    }
  }
} finally { await browser.close(); }
const summary = { base, mode: "frozen-real-asset-replay", newInference: false, recordings: false, sourceManifest: localPath(manifestPath),
  cases: records.map(value => ({ name: value.name, device: value.device, passed: value.passed, checks: value.checks.length, failures: value.checks.filter(check => !check.passed).map(check => check.name) })),
  checkTotal: records.reduce((sum, value) => sum + value.checks.length, 0), passed: records.every(value => value.passed), completedAt: new Date().toISOString() };
writeFileSync(join(outRoot, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (!summary.passed) process.exitCode = 1;
