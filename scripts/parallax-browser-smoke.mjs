// Real upload, local model generation and rendered hold regression.
// Private photos and evidence remain under gitignored screenshots/.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const base = process.env.INTOFRAME_URL || "http://127.0.0.1:5187";
const root = resolve("screenshots/parallax/regression");
mkdirSync(root, { recursive: true });
const cases = [
  ...(process.env.INTOFRAME_TEST_PHOTO
    ? [{ label: "bigben", path: resolve(process.env.INTOFRAME_TEST_PHOTO) }]
    : []),
  { label: "portrait", path: resolve(process.env.INTOFRAME_PERSON_PHOTO || "backend/data/sky-inputs/outdoor-person.png") },
];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function geometry(page) {
  return page.locator(".photo-stage").evaluate((stage) => {
    const host = stage.querySelector(".spatial-canvas");
    const focal = host.clientHeight / (2 * Math.tan(35 * Math.PI / 360));
    const cameraX = Number(stage.dataset.cameraX || 0);
    const wake = Number(stage.style.getPropertyValue("--wake") || 0);
    const subjectX = parseFloat(stage.style.getPropertyValue("--subject-parallax-x")) || 0;
    const zoom = Number(stage.style.getPropertyValue("--photo-zoom")) || 1;
    const skyZ = Number(stage.dataset.skyZ || 0);
    const backgroundX = -focal * cameraX / (3.5 - wake * .035 - skyZ);
    return { cameraX, wake, subjectX: subjectX * zoom, backgroundX: backgroundX * zoom, separation: Math.abs(subjectX - backgroundX) * zoom,
      width: stage.clientWidth, height: stage.clientHeight,
      awake: stage.classList.contains("is-awake"), interactive: stage.classList.contains("spatial-ready"),
      mode: host.dataset.backgroundMode,
      background: stage.querySelector(".background-layer img").getAttribute("src"),
      subject: stage.querySelector(".subject-layer img").getAttribute("src"),
      topBar: stage.querySelector(".letterbox-top").getBoundingClientRect().height,
      bottomBar: stage.querySelector(".letterbox-bottom").getBoundingClientRect().height,
      subjectZ: Number(getComputedStyle(stage.querySelector(".subject-layer")).zIndex),
      barZ: Number(getComputedStyle(stage.querySelector(".letterbox-top")).zIndex),
    };
  });
}

async function center(page) {
  await page.locator(".photo-stage").scrollIntoViewIfNeeded();
  const box = await page.locator(".photo-stage").boundingBox();
  assert(box);
  return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function settled(page) {
  await page.waitForFunction(() => {
    const stage = document.querySelector(".photo-stage");
    return !stage.classList.contains("is-awake") &&
      Math.abs(Number(stage.dataset.cameraX || 0)) < .0001 &&
      Number(stage.style.getPropertyValue("--wake") || 0) < .0002;
  }, null, { timeout: 5000 });
}

async function download(page, path) {
  const pending = page.waitForEvent("download");
  // Programmatic activation keeps the mouse/touch hold on the photo.
  await page.getByRole("button", { name: "Download PNG", exact: true }).evaluate(button => button.click());
  await (await pending).saveAs(path);
  return hash(path);
}

try {
  for (const input of cases) {
    for (const mobile of [false, true]) {
      const label = `${input.label}-${mobile ? "touch" : "desktop"}`;
      const out = join(root, label);
      mkdirSync(out, { recursive: true });
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1050 },
        isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, acceptDownloads: true });
      const errors = [];
      const aiRequests = [];
      const depthAssets = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => {
        if (request.method() === "POST" && /\/api\/(jobs|depth|restyle)$/.test(new URL(request.url()).pathname)) aiRequests.push(request.url());
        if (request.url().includes("render-depth.png")) depthAssets.push(request.url());
      });
      await page.goto(base, { waitUntil: "networkidle" });
      const upload = page.waitForResponse(r => r.url().endsWith("/api/jobs") && r.request().method() === "POST");
      await page.locator("input[type=file]").setInputFiles(input.path);
      const id = (await (await upload).json()).id;
      await page.getByText("YOUR FRAME IS READY").waitFor({ timeout: 180000 });
      await page.locator(".spatial-canvas canvas").waitFor({ timeout: 180000 });
      assert.equal((await geometry(page)).interactive, false, "Pre-generation image must stay still");
      const touch = mobile ? await page.context().newCDPSession(page) : null;
      async function press() {
        const point = await center(page);
        if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
        else { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
        return point;
      }
      async function release(cancel = false) {
        if (touch) await touch.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
        else if (cancel) await page.locator(".photo-stage").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", isPrimary: true });
        else await page.mouse.up();
      }
      await press(); await page.waitForTimeout(350); await release();
      assert.equal((await geometry(page)).cameraX, 0, "Pre-generation hold animated");

      // Inject a transport error once, then retry real generation, never a fake success.
      if (!mobile) {
        await page.route("**/api/restyle", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Temporary test transport failure" }) }), { times: 1 });
        await page.getByRole("button", { name: "Generate background", exact: true }).click();
        await page.getByText("Temporary test transport failure", { exact: true }).waitFor();
      }
      const started = performance.now();
      await page.getByRole("button", { name: "Generate background", exact: true }).click();
      await press(); await page.waitForTimeout(250); await release();
      assert.equal((await geometry(page)).cameraX, 0, "Generating image animated");
      await page.locator(".photo-stage.spatial-ready").waitFor({ timeout: 240000 });
      await page.waitForFunction(() => [...document.querySelectorAll(".photo-stage img")].every(i => i.complete && i.naturalWidth > 0));
      const generatedSeconds = (performance.now() - started) / 1000;
      const source = (await (await page.request.get(`${base}/api/jobs/${id}`)).json()).result;
      const depth = (await (await page.request.get(`${base}/api/depth/${id}`)).json()).result;
      const rest = await geometry(page);
      assert.equal(rest.mode, "sky-layers");
      assert(rest.background.includes("/styles/dreamy-pink/render-background.webp"));
      assert(rest.subject.includes("/styles/dreamy-pink/subject.png"));
      assert.equal(rest.topBar, rest.bottomBar);
      assert(rest.subjectZ > rest.barZ);
      await page.locator(".photo-stage").screenshot({ path: join(out, "rest.png") });
      const stillHash = await download(page, join(out, "export-rest.png"));
      const depthReads = depthAssets.length;
      const inferenceRequests = aiRequests.length;
      await press();
      const samples = [];
      for (let i = 0; i < 10; i++) { await page.waitForTimeout(170); samples.push(await geometry(page)); }
      const peak = samples.reduce((a, b) => a.separation > b.separation ? a : b);
      // This tests perceived depth separation, not just a nonzero camera coordinate.
      assert(peak.separation >= (mobile ? 2 : 4), `${label}: weak separation ${peak.separation}px`);
      assert(peak.separation / peak.width < .025, `${label}: excessive separation`);
      assert(Math.abs(peak.subjectX) / peak.width < .04, `${label}: excessive subject travel`);
      await page.locator(".photo-stage").screenshot({ path: join(out, "hold.png") });
      const aliveHash = await download(page, join(out, "export-hold.png"));
      assert.equal(aliveHash, stillHash, "Hold contaminated the static PNG");
      await release(); await settled(page);
      await page.locator(".photo-stage").screenshot({ path: join(out, "settled.png") });
      assert.equal(aiRequests.length, inferenceRequests, "Hold called AI");
      assert.equal(depthAssets.length, depthReads, "Sky hold fetched old background depth");
      assert.notEqual(hash(join(out, "hold.png")), hash(join(out, "rest.png")), "Rendered photo stayed still");

      await press(); await page.waitForTimeout(700); await release(true); await settled(page);
      if (!mobile) {
        await page.mouse.up();
        const point = await press(); await page.waitForTimeout(700);
        await page.mouse.move(point.box.x - 10, point.y); await settled(page); await page.mouse.up();
        await press(); await page.waitForTimeout(700);
        await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await settled(page); await page.mouse.up();
      }

      await page.getByRole("button", { name: "View before", exact: true }).click();
      await page.locator(".spatial-canvas canvas").waitFor();
      assert.equal(await page.getByRole("button", { name: "Download PNG", exact: true }).isEnabled(), false);
      await press(); await page.waitForTimeout(800);
      const before = await geometry(page);
      await release();
      assert.equal(before.cameraX, 0, "Before animated"); assert.equal(before.interactive, false);
      assert(!before.background.includes("/styles/"));
      await page.getByRole("button", { name: "View after", exact: true }).click();
      await page.locator(".photo-stage.spatial-ready").waitFor();

      await page.getByRole("button", { name: "View mask", exact: true }).click();
      await press(); await page.waitForTimeout(400); await release();
      assert.equal((await geometry(page)).cameraX, 0);
      await page.getByRole("button", { name: "Hide mask", exact: true }).click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await press(); await page.waitForTimeout(400); await release();
      assert.equal((await geometry(page)).cameraX, 0);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.locator(".photo-stage.spatial-ready").waitFor();

      // Sample browser callback timing while the real scene is awake.
      await press();
      const timing = await page.evaluate(() => new Promise(resolve => {
        const times = [];
        function tick(now) {
          times.push(now);
          if (now - times[0] < 1500) return requestAnimationFrame(tick);
          const dt = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
          resolve({ callbacksPerSecond: (times.length - 1) * 1000 / (now - times[0]), p95Ms: dt[Math.floor(dt.length * .95)] });
        }
        requestAnimationFrame(tick);
      }));
      await release(); await settled(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1);
      assert.deepEqual(errors, []);
      const record = { label, id, generatedSeconds, source, depth, rest, peak, settled: await geometry(page), samples, timing, overflow,
        pngSHA256: stillHash, exportDuringHoldIdentical: true, beforeStatic: true,
        releaseAndCancel: true, mouseLeaveAndBlur: !mobile, noInferenceDuringHold: true, errors };
      writeFileSync(join(out, "results.json"), JSON.stringify(record, null, 2));
      results.push(record);
      writeFileSync(join(root, "results.json"), JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ label, generatedSeconds, peakSeparationPx: peak.separation, subjectPx: peak.subjectX, skyPx: peak.backgroundX, timing, overflow, pngIdentical: true, beforeStatic: true }));
      await page.close();
    }
  }
} finally { await browser.close(); }
