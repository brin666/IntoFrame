import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const base = process.env.INTOFRAME_URL || "http://127.0.0.1:5190";
const evidence = resolve("screenshots/submission-film");
mkdirSync(evidence, { recursive: true });
mkdirSync(resolve("public/demo"), { recursive: true });
const ffmpeg = process.platform === "win32"
  ? resolve("node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe") : "ffmpeg";
const manifest = JSON.parse(readFileSync("public/samples/manifest.json", "utf8"));
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.REMOTION_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe" });

async function addCursor(page) {
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.setAttribute("aria-hidden", "true");
    cursor.style.cssText = "position:fixed;left:-40px;top:-40px;width:18px;height:18px;border:2px solid white;border-radius:50%;box-shadow:0 0 0 4px #ffffff24;pointer-events:none;z-index:1000;transform:translate(-50%,-50%);";
    document.body.append(cursor);
    document.addEventListener("pointermove", event => { cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`; });
    document.addEventListener("pointerdown", () => { cursor.style.background = "#ffffff88"; });
    document.addEventListener("pointerup", () => { cursor.style.background = "transparent"; });
  });
}

function encode(raw, segments, output) {
  // Remove waits by cuts only. Every retained action plays at original speed.
  // Remotion's bundled FFmpeg omits trim/setpts video filters. Use input
  // seeking and a concat list so no additional system FFmpeg is required.
  const parts = segments.map(({ start, duration }, i) => {
    const part = resolve(evidence, `${output.includes("workflow") ? "workflow" : "architecture"}-part-${i}.webm`);
    const result = spawnSync(ffmpeg, ["-y", "-ss", String(start), "-i", raw,
      "-r", "30", "-frames:v", String(duration * 30), "-an", "-c:v", "libvpx", "-b:v", "2600k", "-deadline", "realtime", part], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return part;
  });
  const list = resolve(evidence, "concat.txt");
  writeFileSync(list, parts.map(part => `file '${part.replaceAll("\\", "/")}'`).join("\n"));
  const result = spawnSync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", list,
    "-an", "-c", "copy", output], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}

async function workflow() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true,
    recordVideo: { dir: resolve(evidence, "workflow-raw"), size: { width: 1280, height: 900 } } });
  const page = await context.newPage();
  const origin = Date.now();
  const now = () => (Date.now() - origin) / 1000;
  const responses = [];
  page.on("response", response => {
    if (new URL(response.url()).pathname.startsWith("/api/"))
      responses.push({ path: new URL(response.url()).pathname, status: response.status(), at: now() });
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await addCursor(page);
  const uploadStart = now();
  await page.getByRole("button", { name: "Choose a photo" }).scrollIntoViewIfNeeded();
  const upload = await page.getByRole("button", { name: "Choose a photo" }).boundingBox();
  await page.mouse.move(upload.x + upload.width / 2, upload.y + upload.height / 2, { steps: 20 });
  await page.waitForTimeout(1200);
  // Real multipart upload of the credited RGB source; no response interception.
  await page.locator('input[type="file"]').setInputFiles(resolve("public/samples/tower/source.webp"));
  await page.waitForTimeout(5000);
  await page.locator(".photo-stage").waitFor({ timeout: 180000 });
  await page.getByRole("button", { name: /^Dreamy Pink/ }).scrollIntoViewIfNeeded();
  const selectionStart = now();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: /^Dreamy Pink/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Generate background", exact: true }).click();
  await page.waitForTimeout(5600);
  await page.getByRole("button", { name: "Skip animation", exact: true }).waitFor({ timeout: 180000 });
  const revealStart = now();
  await page.locator(".photo-stage").scrollIntoViewIfNeeded();
  await page.waitForTimeout(8200);
  await page.locator(".style-actions").scrollIntoViewIfNeeded();
  const exportStart = now();
  await page.getByRole("button", { name: "View before", exact: true }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "View after", exact: true }).click();
  await page.waitForTimeout(1800);
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).click();
  const download = await downloadPending;
  await download.saveAs(resolve(evidence, "workflow-export.png"));
  await page.waitForTimeout(4700);
  const video = page.video();
  await context.close();
  assert(responses.some(r => r.path === "/api/jobs" && r.status === 202), "Actual upload response missing");
  assert(responses.some(r => r.path === "/api/restyle" && r.status === 202), "Actual Generate response missing");
  assert(!responses.some(r => r.status >= 400), "Backend request failed during recording");
  const segments = [{ start: uploadStart, duration: 6 }, { start: selectionStart, duration: 8 },
    { start: revealStart, duration: 8 }, { start: exportStart, duration: 8 }];
  encode(await video.path(), segments, resolve("public/demo/workflow.webm"));
  writeFileSync(resolve(evidence, "workflow.json"), JSON.stringify({ actualBrowserRecording: true,
    actualModelInference: true, responseInterception: false, base, source: "public/samples/tower/source.webp",
    duration: 30, editing: "Processing waits shortened by cuts; retained actions play at original speed",
    segments, responses, downloadedPngBytes: readFileSync(resolve(evidence, "workflow-export.png")).length }, null, 2));
  console.log("Recorded real upload / Generate / reveal / Before-After / PNG workflow.");
}

async function interaction() {
  const second = manifest.samples.find(s => s.id === "qutub") || manifest.samples.find(s => s.id === "flatiron") || manifest.samples.find(s => s.id === "taipei");
  assert(second, "A second accepted building is required");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 },
    recordVideo: { dir: resolve(evidence, "architecture-raw"), size: { width: 1280, height: 900 } } });
  const page = await context.newPage();
  const origin = Date.now(), segments = [], states = [], requests = [];
  page.on("request", r => { if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url()); });
  for (const id of ["tower", second.id]) {
    await page.goto(`${base}/?sample=${id}`, { waitUntil: "networkidle" });
    await addCursor(page);
    const stage = page.locator(".photo-stage.spatial-ready");
    await stage.waitFor({ timeout: 30000 }); await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox(); assert(box);
    const start = Date.now();
    const inspect = async label => states.push({ sample: id, label, at: Date.now() - start,
      data: await stage.evaluate(element => ({ ...element.dataset })) });
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .55);
    await page.waitForTimeout(800); await inspect("center");
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .82, box.y + box.height * .55, { steps: 40 });
    await page.waitForTimeout(1050); await inspect("right-drag");
    await page.mouse.move(box.x + box.width * .18, box.y + box.height * .55, { steps: 55 });
    await page.waitForTimeout(1050); await inspect("left-drag");
    await page.mouse.up(); await page.mouse.move(box.x + box.width + 20, box.y + box.height * .55);
    await page.waitForTimeout(Math.max(3200, 8400 - (Date.now() - start))); await inspect("released");
    const pair = states.filter(s => s.sample === id);
    assert(pair[1].data.motionMode === "drag" && pair[2].data.motionMode === "drag");
    assert(Math.abs(Number(pair[1].data.cameraX) - Number(pair[2].data.cameraX)) > .001, `${id}: no real camera travel`);
    segments.push({ start: (start - origin) / 1000, duration: 8 });
  }
  const video = page.video(); await context.close();
  assert.equal(requests.length, 0, "Cached architecture interaction called AI");
  encode(await video.path(), segments, resolve("public/demo/architecture-interaction.webm"));
  writeFileSync(resolve(evidence, "architecture-interaction.json"), JSON.stringify({ actualBrowserRecording: true,
    base, duration: 16, samples: ["tower", second.id], apiRequests: requests, states,
    editing: "Two eight-second captures, normal speed. Cursor follows actual pointer events; no camera override." }, null, 2));
  console.log("Recorded two architecture samples with trusted drag and release.");
}

try {
  if (!process.argv.includes("--interaction-only")) await workflow();
  if (!process.argv.includes("--workflow-only")) await interaction();
} finally { await browser.close(); }
