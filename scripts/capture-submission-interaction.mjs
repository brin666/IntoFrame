import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const base = process.env.INTOFRAME_URL || "http://127.0.0.1:5190";
const evidence = resolve("screenshots/submission-film");
mkdirSync(evidence, { recursive: true });
mkdirSync(resolve("public/demo"), { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.REMOTION_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
let recording;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 },
    recordVideo: { dir: resolve(evidence, "raw-recording"), size: { width: 1280, height: 800 } } });
  const page = await context.newPage();
  const origin = Date.now();
  const api = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url()); });
  await page.goto(`${base}/?sample=tower`, { waitUntil: "networkidle" });
  const stage = page.locator(".photo-stage.spatial-ready");
  await stage.waitFor({ timeout: 30000 });
  await page.locator(".photo-stage").scrollIntoViewIfNeeded();
  // This marker follows actual trusted pointer events; it does not drive the
  // scene or camera. Browser video capture normally omits the OS cursor.
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.setAttribute("aria-hidden", "true");
    cursor.style.cssText = "position:fixed;left:-40px;top:-40px;width:18px;height:18px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 4px #ffffff24;pointer-events:none;z-index:1000;transform:translate(-50%,-50%);";
    document.body.append(cursor);
    document.addEventListener("pointermove", event => { cursor.style.left=`${event.clientX}px`;cursor.style.top=`${event.clientY}px`; });
    document.addEventListener("pointerdown", () => { cursor.style.background="#ffffff88"; });
    document.addEventListener("pointerup", () => { cursor.style.background="transparent"; });
  });
  const box = await stage.boundingBox();
  if (!box) throw new Error("Sample photo is not visible.");
  const start = Date.now();
  const states = [];
  const inspect = async label => states.push({ label, at: Date.now() - start,
    data: await page.locator(".photo-stage").evaluate(element => ({ ...element.dataset })) });
  await page.mouse.move(box.x + box.width*.5, box.y + box.height*.55);
  await page.waitForTimeout(1000);await inspect("center");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width*.82, box.y + box.height*.55, { steps: 50 });
  await page.waitForTimeout(1800);await inspect("right-drag");
  await page.mouse.move(box.x + box.width*.18, box.y + box.height*.55, { steps: 80 });
  await page.waitForTimeout(1800);await inspect("left-drag");
  await page.mouse.up();
  await page.mouse.move(box.x + box.width + 24, box.y + box.height*.55);
  await page.waitForTimeout(Math.max(1000, 10600 - (Date.now() - start)));await inspect("released");
  if (api.length) throw new Error("Saved sample unexpectedly called the model API.");
  if (states[1].data.motionMode !== "drag" || states[2].data.motionMode !== "drag" ||
      Math.abs(Number(states[1].data.cameraX) - Number(states[2].data.cameraX)) < .001)
    throw new Error("Real drag did not change the camera.");
  recording = page.video();
  await context.close();
  const raw = await recording.path();
  const trimStart = (start - origin) / 1000;
  const ffmpeg = process.platform === "win32"
    ? resolve("node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe") : "ffmpeg";
  const result = spawnSync(ffmpeg, ["-y", "-ss", String(trimStart), "-i", raw, "-t", "10",
    "-an", "-c:v", "libvpx", "-b:v", "2200k", "-deadline", "realtime",
    resolve("public/demo/interaction.webm")], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  writeFileSync(resolve(evidence,"interaction.json"), JSON.stringify({
    base, sample: "tower", actualBrowserRecording: true, apiRequests: api,
    states, trimStart, duration: 10, viewport: { width:1280,height:800 },
    cursor: "Marker driven by real trusted pointer events only; no geometry override",
  }, null, 2));
  console.log("Real interaction recorded: public/demo/interaction.webm");
} finally { await browser.close(); }
