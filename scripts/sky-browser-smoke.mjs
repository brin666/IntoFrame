// Real semantic analysis and generation, including conservative no-sky rejection.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.INTOFRAME_URL || "http://127.0.0.1:5190";
const out = resolve(process.env.INTOFRAME_EVIDENCE_DIR || "screenshots/sky-regression");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  for (const [label, path, expected] of [
    ["coffee", "backend/data/smoke/object_coffee_source.webp", false],
    ["indoor-cat", "backend/data/smoke/pet_chelsea_source.webp", false],
    ["ambiguous-portrait", "backend/data/sky-inputs/portrait-sky.png", false],
    ["partial-sky-scene", process.env.INTOFRAME_SCENE_PHOTO || "backend/data/sky-inputs/scene-rocket.png", null],
    ["new-outdoor-person", process.env.INTOFRAME_PERSON_PHOTO || "backend/data/sky-inputs/outdoor-person.png", true],
  ].filter(([label]) => !process.env.INTOFRAME_CASE || label === process.env.INTOFRAME_CASE)) {
    const upload = page.waitForResponse(r => r.url().endsWith("/api/jobs") && r.request().method() === "POST");
    await page.locator("input[type=file]").setInputFiles(resolve(path));
    const id = (await (await upload).json()).id;
    await page.getByText("YOUR FRAME IS READY").or(page.getByText("That didn’t work.")).first().waitFor({ timeout: 180000 });
    const job = await (await page.request.get(`${base}/api/jobs/${id}`)).json();
    if (job.status === "failed") {
      assert.equal(expected, null, `${label}: required sample failed upload: ${job.error}`);
      await page.getByText(job.error, { exact: true }).waitFor();
      await page.screenshot({ path: join(out, `${label}-upload-rejected.png`), fullPage: true });
      records.push({ label, id, rejectedUpload: job.error });
      continue;
    }
    const source = job.result;
    if (expected !== null) assert.equal(source.sky.eligible, expected, `${label} unexpected sky classification`);
    const stage = page.locator(".photo-stage");
    assert(!(await page.locator(".background-layer img").getAttribute("src")).includes("/styles/"), "New upload retained old style");
    assert.equal((await stage.getAttribute("class")).includes("is-awake"), false);
    if (!source.sky.eligible) {
      assert.equal(await page.getByRole("button", { name: "Generate background", exact: true }).isEnabled(), false);
      await page.getByText(source.sky.reason, { exact: true }).waitFor();
      const response = await page.request.post(`${base}/api/restyle`, { data: { jobId: id, style: "dreamy-pink" } });
      assert.equal(response.status(), 422, "No-sky API scheduled diffusion");
      assert.equal((await page.request.get(`${base}/api/restyle/${id}/dreamy-pink`)).status(), 404);
      assert.equal(await page.getByRole("button", { name: "Download PNG", exact: true }).isEnabled(), false);
      await stage.screenshot({ path: join(out, `${label}-rejected.png`) });
      records.push({ label, id, source, rejected422: true, noGeneratedJob: true });
      continue;
    }
    await page.locator(".spatial-canvas canvas").waitFor({ timeout: 180000 });
    await page.getByRole("button", { name: "Generate background", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Golden Hour", exact: false }).isEnabled(), false, "Style changed during generation");
    await page.locator(".photo-stage.spatial-ready").waitFor({ timeout: 240000 });
    await page.waitForFunction(() => [...document.querySelectorAll(".photo-stage img")].every(i => i.complete && i.naturalWidth > 0));
    const styled = (await (await page.request.get(`${base}/api/restyle/${id}/dreamy-pink`)).json()).result;
    assert.equal(await page.locator(".spatial-canvas").getAttribute("data-background-mode"), "sky-layers");
    const canvas = page.locator(".spatial-canvas canvas");
    assert.equal(await canvas.getAttribute("data-sky-url"), styled.renderSkyUrl);
    assert.equal(await canvas.getAttribute("data-scene-url"), styled.renderSceneUrl);
    await stage.screenshot({ path: join(out, `${label}-after.png`) });
    const beforeDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PNG", exact: true }).click();
    await (await beforeDownload).saveAs(join(out, `${label}-export.png`));
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(1500);
    const camera = Number(await stage.getAttribute("data-camera-x"));
    assert(Math.abs(camera) > .0001);
    await stage.screenshot({ path: join(out, `${label}-hold.png`) });
    // Even showing a cached generated result cancels the previous hold.
    await page.getByRole("button", { name: "Show result", exact: true }).evaluate(b => b.click());
    await page.waitForFunction(() => !document.querySelector(".photo-stage").classList.contains("is-awake") && Math.abs(Number(document.querySelector(".photo-stage").dataset.cameraX)) < .0001);
    await page.mouse.up();
    await page.getByRole("button", { name: "View before", exact: true }).click();
    assert(!(await page.locator(".background-layer img").getAttribute("src")).includes("/styles/"));
    await page.getByRole("button", { name: "View after", exact: true }).click();
    await page.locator(".photo-stage.spatial-ready").waitFor();
    records.push({ label, id, source, styled, camera, newUploadClearsStyle: true, cachedShowSettles: true });
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "results.json"), JSON.stringify(records, null, 2));
  console.log(JSON.stringify(records.map(r => ({ label: r.label, id: r.id, skyFraction: r.source?.sky.skyFraction, rejected: !!r.rejected422 || !!r.rejectedUpload, camera: r.camera }))));
} finally { await browser.close(); }
