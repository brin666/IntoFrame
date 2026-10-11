// Deterministic browser evidence using saved, real model assets and API results.
// This is explicitly a frozen replay; it does not claim a new model inference.
// Example: node scripts/edge-browser-replay.mjs --manifest screenshots/edge-repair/frozen-manifest.json --out screenshots/edge-repair/browser-before --case before
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
const manifestPath = resolve(argument("manifest", process.env.EDGE_REPLAY_MANIFEST || "screenshots/edge-repair/frozen-manifest.json"));
const base = argument("base", process.env.INTOFRAME_URL || "http://127.0.0.1:5190").replace(/\/$/, "");
const outRoot = resolve(argument("out", process.env.EDGE_EVIDENCE_ROOT || "screenshots/edge-repair/browser-before"));
const fixtureNamespace = argument("fixture", basename(outRoot));
assert(/^[a-z0-9_-]+$/i.test(fixtureNamespace), "Fixture namespace must be a safe directory name");
const caseName = argument("case", process.env.EDGE_REPLAY_CASE || "before");
const onlyDesktop = process.argv.includes("--desktop-only");
const onlyMobile = process.argv.includes("--mobile-only");
const baselinePath = argument("baseline", process.env.EDGE_REPLAY_BASELINE);
const includeNames = argument("include", process.env.EDGE_REPLAY_INCLUDE)?.split(",");
const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const fileHash = (path) => sha(readFileSync(path));
const localPath = (path) => relative(resolve("."), path).replaceAll("\\", "/");
const modelFiles = ["src/parallax.ts", "src/SpatialFrameScene.tsx", "src/frameComposition.ts"];
const motionSource = Object.fromEntries(modelFiles.map(path => [path, fileHash(resolve(path))]));
const styleLabels = { "dreamy-pink": "Dreamy Pink", "golden-hour": "Golden Hour", "cinematic-night": "Cinematic Night" };

function filesBelow(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? filesBelow(root, path) : [path];
  });
}
function rewriteUrls(value, sourcePrefix, mediaPrefix) {
  if (typeof value === "string") return value.replace(`${sourcePrefix}/`, `${mediaPrefix}/`);
  if (Array.isArray(value)) return value.map(item => rewriteUrls(item, sourcePrefix, mediaPrefix));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteUrls(item, sourcePrefix, mediaPrefix)]));
  return value;
}
function prepareCase(value, index) {
  const name = value.name || value.label || (index ? `${caseName}-${index}` : caseName);
  assert(/^[a-z0-9_-]+$/i.test(name), "Case names must be safe fixture directory names");
  const id = value.jobId || value.job?.result?.id;
  assert(id && value.job?.result && value.depth?.result, `${name}: missing captured job/depth API results`);
  const assetDir = resolve(argument("assets", process.env.EDGE_REPLAY_ASSETS || value.assetDir || join(dirname(manifestPath), "before")));
  const fixtureDir = resolve("backend/data/edge-repair-fixtures/browser-replay", fixtureNamespace, name);
  const mediaPrefix = `/media/edge-repair-fixtures/browser-replay/${fixtureNamespace}/${name}`;
  const sourcePrefix = value.mediaPrefix || `/media/${id}`;
  const hashes = {};
  for (const file of filesBelow(assetDir)) {
    const source = join(assetDir, file), target = join(fixtureDir, file);
    const digest = fileHash(source), expected = value.files?.[file] || value.files?.[file.replaceAll("\\", "/")];
    if (expected) assert.equal(digest, expected, `${name}: frozen asset hash changed: ${file}`);
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target) || fileHash(target) !== digest) copyFileSync(source, target);
    assert.equal(fileHash(target), digest, `${name}: source asset changed during fixture snapshot: ${file}`);
    hashes[file.replaceAll("\\", "/")] = digest;
  }
  const savedStyles = value.styles || { [value.style?.result?.style || "cinematic-night"]: value.style };
  return { name, id, assetDir, fixtureDir, mediaPrefix, hashes,
    baselineName: value.baselineName,
    devices: value.devices,
    selectedStyle: argument("style", value.selectedStyle || "cinematic-night"),
    job: rewriteUrls(value.job, sourcePrefix, mediaPrefix), depth: rewriteUrls(value.depth, sourcePrefix, mediaPrefix),
    styles: rewriteUrls(savedStyles, sourcePrefix, mediaPrefix),
    photo: resolve(value.photo || join(assetDir, "source.webp")),
  };
}
const rawCases = raw.cases || (raw.job ? [raw] : Object.entries(raw).map(([name, value]) => ({ name, ...value })));
const cases = rawCases.map(prepareCase);
mkdirSync(outRoot, { recursive: true });
const records = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function geometry(page) {
  return page.locator(".photo-stage").evaluate(stage => {
    const host = stage.querySelector(".spatial-canvas");
    const subject = stage.querySelector(".subject-layer img");
    const background = stage.querySelector(".background-layer img");
    const rect = stage.getBoundingClientRect();
    const zoom = Number(stage.style.getPropertyValue("--photo-zoom") || 1);
    const cameraX = Number(stage.dataset.cameraX || 0), wake = Number(stage.style.getPropertyValue("--wake") || 0);
    const subjectX = parseFloat(stage.style.getPropertyValue("--subject-parallax-x")) || 0;
    const skyZ = Number(stage.dataset.skyZ || 0);
    const focal = host ? host.clientHeight / (2 * Math.tan(35 * Math.PI / 360)) : 0;
    const skyX = -focal * cameraX / (3.5 - wake * .035 - skyZ);
    return { cameraX, wake, subjectX: subjectX * zoom, skyX: skyX * zoom, separation: Math.abs(subjectX - skyX) * zoom,
      width: stage.clientWidth, height: stage.clientHeight, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      zoom, shiftX: stage.style.getPropertyValue("--photo-x"), shiftY: stage.style.getPropertyValue("--photo-y"),
      subjectScale: stage.style.getPropertyValue("--subject-parallax-scale"),
      subjectTransform: getComputedStyle(subject).transform, sceneTransform: getComputedStyle(stage.querySelector(".subject-layer")).transform,
      mode: host?.dataset.backgroundMode, skyZ, targetGap: Number(stage.dataset.targetGap || 0),
      awake: stage.classList.contains("is-awake"), interactive: stage.classList.contains("spatial-ready"),
      backgroundUrl: background?.getAttribute("src"), subjectUrl: subject?.getAttribute("src"),
      canvas: host?.querySelector("canvas")?.dataset,
      topBar: stage.querySelector(".letterbox-top").getBoundingClientRect().height,
      bottomBar: stage.querySelector(".letterbox-bottom").getBoundingClientRect().height,
    };
  });
}
async function settled(page) {
  await page.waitForFunction(() => {
    const stage = document.querySelector(".photo-stage");
    return stage && !stage.classList.contains("is-awake") && Math.abs(Number(stage.dataset.cameraX || 0)) < .0001 && Number(stage.style.getPropertyValue("--wake") || 0) < .0002;
  }, null, { timeout: 10000 });
}
async function ready(page, style) {
  await page.locator(".photo-stage.spatial-ready").waitFor({ timeout: 30000 });
  await page.waitForFunction(style => {
    const stage = document.querySelector(".photo-stage");
    const canvas = stage?.querySelector(".spatial-canvas canvas");
    return canvas?.style.visibility === "visible" && stage.querySelector(".subject-layer img").src.includes(`/styles/${style}/`) && [...stage.querySelectorAll("img")].every(image => image.complete && image.naturalWidth > 0);
  }, style, { timeout: 30000 });
  await settled(page);
}
async function saveStage(page, out, name, noBars = true) {
  async function shot(path) {
    await page.locator(".photo-stage").scrollIntoViewIfNeeded();
    const clip = await page.locator(".photo-stage").boundingBox(); assert(clip);
    await page.screenshot({ path, clip });
  }
  await shot(join(out, `${name}.png`));
  const actual = await geometry(page);
  if (noBars) {
    await page.evaluate(() => document.documentElement.classList.add("edge-evidence-no-bars"));
    await shot(join(out, `${name}-full-scene.png`));
    await page.evaluate(() => document.documentElement.classList.remove("edge-evidence-no-bars"));
  }
  return actual;
}
async function download(page, path) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).evaluate(button => button.click());
  await (await pending).saveAs(path);
  return fileHash(path);
}

try {
  for (const input of cases.filter(value => !includeNames || includeNames.includes(value.name))) {
    const devices = onlyDesktop ? [false] : onlyMobile ? [true] : input.devices?.map(value => value === "mobile") || [false, true];
    for (const mobile of devices) {
      const device = mobile ? "mobile" : "desktop";
      const out = join(outRoot, cases.length === 1 ? device : `${input.name}-${device}`);
      mkdirSync(out, { recursive: true });
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1050 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, acceptDownloads: true });
      const errors = [], consoleErrors = [], httpErrors = [], requests = [], unknownRequests = [], javascriptAssets = {};
      const screenshots = [];
      let activeInput = input;
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
      page.on("response", async response => {
        if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
        if (/\.js(?:\?|$)/.test(response.url())) {
          try { javascriptAssets[new URL(response.url()).pathname] = sha(await response.body()); } catch { /* Aborted loads have no body. */ }
        }
      });
      await page.route("**/api/**", async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        requests.push({ path, method: request.method(), time: Date.now() });
        let response;
        if (path === "/api/jobs" && request.method() === "POST") response = { id: activeInput.id };
        else if (path === `/api/jobs/${activeInput.id}`) response = activeInput.job;
        else if (path === "/api/depth" && request.method() === "POST") response = { id: activeInput.id };
        else if (path === `/api/depth/${activeInput.id}`) response = activeInput.depth;
        else if (path === "/api/restyle" && request.method() === "POST") {
          const style = request.postDataJSON().style;
          assert(activeInput.styles[style], `${activeInput.name}: no captured real assets for ${style}`);
          response = { id: activeInput.id, style };
        } else if (path.startsWith(`/api/restyle/${activeInput.id}/`)) response = activeInput.styles[path.split("/").at(-1)];
        if (!response) { unknownRequests.push(path); await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: "Frozen replay has no captured response for this request" }) }); return; }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
      });
      await page.goto(base, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: ".edge-evidence-no-bars .photo-stage .letterbox{visibility:hidden!important}.edge-evidence-no-bars .photo-stage .background-layer{clip-path:none!important}" });
      await page.locator("input[type=file]").setInputFiles(input.photo);
      await page.getByText("YOUR FRAME IS READY").waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector(".spatial-canvas canvas")?.style.visibility === "visible", null, { timeout: 30000 });
      const touch = mobile ? await page.context().newCDPSession(page) : null;
      async function press() {
        await page.locator(".photo-stage").scrollIntoViewIfNeeded();
        const box = await page.locator(".photo-stage").boundingBox(); assert(box);
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        else { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
      }
      async function release(cancel = false) {
        if (touch) await touch.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
        else if (cancel) await page.locator(".photo-stage").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", isPrimary: true });
        else await page.mouse.up();
      }
      await press(); await page.waitForTimeout(300); const preGeneration = await geometry(page); await release();
      assert.equal(preGeneration.cameraX, 0, "Frozen original photo animated before a style was selected");
      await page.getByRole("button", { name: styleLabels[input.selectedStyle], exact: false }).click();
      await page.getByRole("button", { name: "Generate background", exact: true }).click();
      await ready(page, input.selectedStyle);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(out, "ui-center.png"), fullPage: true });
      const capture = async name => {
        try {
          const before = await geometry(page);
          const after = await saveStage(page, out, name);
          assert.equal(after.subjectUrl, before.subjectUrl, "Photo resource changed during screenshot");
          screenshots.push({ name, normal: `${name}.png`, fullScene: `${name}-full-scene.png`, before, after, capturedAt: new Date().toISOString() });
          return after;
        } catch (error) {
          await page.screenshot({ path: join(out, "capture-failure.png"), fullPage: true });
          writeFileSync(join(out, "capture-failure.json"), JSON.stringify({ name, error: error.message, page: await page.locator("body").innerText(), requests, errors, consoleErrors, httpErrors }, null, 2));
          throw error;
        }
      };
      const center = await capture("center");
      const stillHash = await download(page, join(out, "export-rest.png"));
      writeFileSync(join(out, "baseline-frozen.json"), JSON.stringify({ replay: "saved real model/API results; no new inference", manifestPath: localPath(manifestPath), input: { ...input, photo: localPath(input.photo), assetDir: localPath(input.assetDir), fixtureDir: localPath(input.fixtureDir) }, center, stillHash }, null, 2));
      console.log(`${input.name}/${device}: frozen center and PNG saved`);
      const requestCount = requests.length;
      await press();
      await page.evaluate(() => {
        window.edgeEvidenceSamples = []; window.edgeEvidenceStop = false;
        const started = performance.now();
        function tick(now) {
          const stage = document.querySelector(".photo-stage");
          window.edgeEvidenceSamples.push({ milliseconds: now - started, cameraX: Number(stage.dataset.cameraX || 0), wake: Number(stage.style.getPropertyValue("--wake") || 0), subjectX: parseFloat(stage.style.getPropertyValue("--subject-parallax-x")) || 0 });
          if (!window.edgeEvidenceStop) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      const extrema = {}, started = Date.now(); let previous = null, direction = 0;
      while (Date.now() - started < 8200) {
        await page.waitForTimeout(65);
        const current = await geometry(page);
        if (previous) {
          const delta = current.cameraX - previous.cameraX;
          const nextDirection = Math.abs(delta) > .000001 ? Math.sign(delta) : direction;
          if (direction === 1 && nextDirection === -1 && current.cameraX > 0 && !extrema.right) extrema.right = await capture("camera-right-extremum");
          if (direction === -1 && nextDirection === 1 && current.cameraX < 0 && !extrema.left) extrema.left = await capture("camera-left-extremum");
          direction = nextDirection;
        }
        previous = current;
      }
      const hold = await geometry(page);
      const aliveHash = await download(page, join(out, "export-hold.png"));
      const samples = await page.evaluate(() => { window.edgeEvidenceStop = true; return window.edgeEvidenceSamples; });
      await release(); await settled(page);
      const settle = await capture("settled");
      assert.equal(aliveHash, stillHash, "Hold changed centered PNG export");
      assert.equal(requests.length, requestCount, "Hold or export requested an API job");
      await page.getByRole("button", { name: "View before", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".spatial-canvas canvas")?.style.visibility === "visible");
      const before = await capture("before-static");
      await press(); await page.waitForTimeout(400); const beforeHold = await geometry(page); await release();
      assert.equal(beforeHold.cameraX, 0, "Before preview animated"); assert.equal(beforeHold.interactive, false);
      await page.getByRole("button", { name: "View after", exact: true }).click(); await ready(page, input.selectedStyle);
      const after = await capture("after-static");
      await press(); await page.waitForTimeout(400);
      const otherStyle = Object.keys(input.styles).find(style => style !== input.selectedStyle) || Object.keys(styleLabels).find(style => style !== input.selectedStyle);
      await page.getByRole("button", { name: styleLabels[otherStyle], exact: false }).evaluate(button => button.click());
      await settled(page); const styleSwitch = await geometry(page); await release();
      assert.equal(styleSwitch.interactive, false, "Ungenerated style inherited Night interaction");
      assert(!styleSwitch.subjectUrl.includes(`/styles/${input.selectedStyle}/`), "Ungenerated style inherited Night subject");
      let styleResourceSwitch = null;
      if (input.styles[otherStyle]) {
        await page.getByRole("button", { name: "Generate background", exact: true }).click(); await ready(page, otherStyle);
        styleResourceSwitch = await capture("style-resource-switch");
        assert(styleResourceSwitch.subjectUrl.includes(`/styles/${otherStyle}/`), "Style switch did not attach captured real subject resource");
        assert(styleResourceSwitch.backgroundUrl.includes(`/styles/${otherStyle}/`), "Style switch did not attach captured real background resource");
      }
      await page.getByRole("button", { name: styleLabels[input.selectedStyle], exact: false }).click(); await ready(page, input.selectedStyle);
      const returnedStyle = await geometry(page);
      await press(); await page.waitForTimeout(400);
      const alternate = cases.find(value => value.id !== input.id) || input;
      activeInput = alternate;
      await page.locator("input[type=file]").setInputFiles(alternate.photo);
      await page.getByText("YOUR FRAME IS READY").waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector(".spatial-canvas canvas")?.style.visibility === "visible");
      await page.waitForFunction(url => document.querySelector(".subject-layer img")?.getAttribute("src") === url, alternate.job.result.subjectUrl);
      await release(); const photoSwitch = await geometry(page);
      assert.equal(photoSwitch.cameraX, 0, "A new photo retained old camera motion"); assert.equal(photoSwitch.interactive, false);
      assert(!photoSwitch.subjectUrl.includes("/styles/"), "A new photo retained the old styled subject");
      assert.equal(photoSwitch.subjectUrl, alternate.job.result.subjectUrl, "A new photo did not attach its own source subject");
      const differentPhotoResourceSwitch = alternate.id !== input.id;
      if (differentPhotoResourceSwitch) {
        await capture("photo-resource-switch");
        activeInput = input;
        await page.locator("input[type=file]").setInputFiles(input.photo);
        await page.getByText("YOUR FRAME IS READY").waitFor({ timeout: 30000 });
        await page.waitForFunction(() => document.querySelector(".spatial-canvas canvas")?.style.visibility === "visible");
        await page.waitForFunction(url => document.querySelector(".subject-layer img")?.getAttribute("src") === url, input.job.result.subjectUrl);
      }
      await page.getByRole("button", { name: styleLabels[input.selectedStyle], exact: false }).click();
      await page.getByRole("button", { name: "Generate background", exact: true }).click(); await ready(page, input.selectedStyle);
      const restored = await geometry(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1, `Page overflow ${overflow}px`); assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(httpErrors, []); assert.deepEqual(unknownRequests, []);
      const record = { name: input.name, baselineName: input.baselineName, selectedStyle: input.selectedStyle, device, base, mode: "frozen-real-asset-replay", newInference: false, viewport: page.viewportSize(), sourceManifest: localPath(manifestPath), mediaPrefix: input.mediaPrefix, assetHashes: input.hashes,
        motionSource, javascriptAssets, api: { job: input.job, depth: input.depth, styles: input.styles },
        preGeneration, center, extrema, hold, settle, before, beforeHold, after, styleSwitch, styleResourceSwitch, returnedStyle, photoSwitch, differentPhotoResourceSwitch, restored, samples, screenshots,
        exportSHA256: stillHash, holdExportSHA256: aliveHash, exportDuringHoldIdentical: true, noApiRequestsDuringHold: true, overflow, errors, consoleErrors, httpErrors, unknownRequests, requests,
        diagnosticFullSceneOverride: "Only screenshot diagnostic CSS hides DOM letterboxes and removes background clip-path. No production files are changed.",
        screenshotHashes: Object.fromEntries(readdirSync(out).filter(file => file.endsWith(".png")).map(file => [file, fileHash(join(out, file))])),
      };
      writeFileSync(join(out, "results.json"), JSON.stringify(record, null, 2)); records.push(record);
      writeFileSync(join(outRoot, "results.json"), JSON.stringify(records, null, 2));
      console.log(JSON.stringify({ name: input.name, device, center, observedCameraRange: [Math.min(...samples.map(sample => sample.cameraX)), Math.max(...samples.map(sample => sample.cameraX))], extremaCaptured: Object.keys(extrema), exportDuringHoldIdentical: true, errors }));
      await page.close();
    }
  }
  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(resolve(baselinePath), "utf8"));
    const comparisons = records.map(record => {
      const matchingDevice = baseline.filter(entry => entry.device === record.device);
      const before = matchingDevice.find(entry => entry.name === (record.baselineName || record.name)) ||
        matchingDevice.find(entry => entry.assetHashes?.["source.webp"] === record.assetHashes?.["source.webp"] && (entry.selectedStyle || "cinematic-night") === record.selectedStyle);
      if (!before) return { name: record.name, device: record.device, comparison: "independent case; no matching captured baseline source/style" };
      assert.deepEqual(record.motionSource, before.motionSource, "Motion source changed between baseline and repaired replay");
      const range = value => [Math.min(...value.samples.map(sample => sample.cameraX)), Math.max(...value.samples.map(sample => sample.cameraX))];
      const fields = ["width", "height", "zoom", "shiftX", "shiftY", "skyZ", "targetGap"];
      const transforms = Object.fromEntries(fields.map(field => [field, { before: before.center[field], after: record.center[field], identical: before.center[field] === record.center[field] }]));
      for (const field of fields) assert.equal(record.center[field], before.center[field], `${record.name}/${record.device}: centered geometry changed: ${field}`);
      return { name: record.name, device: record.device, motionSourceUnchanged: true, centeredGeometryIdentical: true, transforms, beforeObservedRange: range(before), afterObservedRange: range(record), sampleTiming: "Real requestAnimationFrame timestamps; small sampled extrema differences can arise from callback timing." };
    });
    writeFileSync(join(outRoot, "trajectory-comparison.json"), JSON.stringify(comparisons, null, 2));
  }
} finally { await browser.close(); }
