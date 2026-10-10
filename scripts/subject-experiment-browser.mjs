import { chromium } from "playwright";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.env.EXPERIMENT_URL || "http://127.0.0.1:5190/experiment.html";
const out = resolve("screenshots/subject-depth-experiment");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--enable-webgl"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 940 },
  deviceScaleFactor: 1,
  recordVideo: { dir: out, size: { width: 1440, height: 940 } },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("status").getByText(/Ready/).waitFor({ timeout: 60000 });
  const stage = page.locator(".experiment-stage");
  const images = [];
  for (const mode of ["flat", "depth"]) {
    await page.locator(`button[data-mode="${mode}"]`).click();
    for (const view of ["left", "center", "right"]) {
      await page.locator(`[data-view="${view}"]`).click();
      await page.waitForTimeout(1250);
      const x = Number(await stage.getAttribute("data-camera-x"));
      await stage.screenshot({ path: resolve(out, `${mode}-${view}.png`) });
      images.push({ mode, view, cameraX: x });
    }
  }
  await page.locator('button[data-mode="debug"]').click();
  await page.locator('[data-view="center"]').click();
  await page.waitForTimeout(1300);
  await stage.screenshot({ path: resolve(out, "debug-center.png") });

  // Stress check: maximum debug settings, kept outside the seven baseline views.
  await page.locator('button[data-mode="depth"]').click();
  await page.locator('.experiment-slider input').first().focus();
  await page.keyboard.press('End');
  await page.locator('.experiment-slider input').nth(1).focus();
  await page.keyboard.press('End');
  for (const view of ["left", "right"]) {
    await page.locator(`[data-view="${view}"]`).click();
    await page.waitForTimeout(1250);
    await stage.screenshot({ path: resolve(out, `stress-depth-${view}.png`) });
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("status").getByText(/Ready/).waitFor({ timeout: 60000 });

  await page.locator('button[data-mode="depth"]').click();
  const box = await stage.boundingBox();
  if (!box) throw new Error("Missing experiment stage");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  const awakeX1 = Number(await stage.getAttribute("data-camera-x"));
  const timing = await page.evaluate(() => new Promise(resolve => {
    const times = [];
    let started;
    function sample(now) {
      if (started === undefined) started = now;
      times.push(now);
      if (now - started < 2200) requestAnimationFrame(sample);
      else {
        const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
        resolve({
          callbacksPerSecond: Number(((times.length - 1) * 1000 / (times.at(-1) - times[0])).toFixed(1)),
          p95IntervalMs: Number(intervals[Math.floor(intervals.length * 0.95)].toFixed(2)),
        });
      }
    }
    requestAnimationFrame(sample);
  }));
  const awakeX2 = Number(await stage.getAttribute("data-camera-x"));
  await page.mouse.up();
  await page.waitForTimeout(1600);
  const settledX = Number(await stage.getAttribute("data-camera-x"));
  if (Math.abs(awakeX1 - awakeX2) < 0.003) throw new Error("Hold did not produce camera sway");
  if (Math.abs(settledX) > 0.003) throw new Error(`Camera failed to settle: ${settledX}`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  const result = { url: base, images, awakeX1, awakeX2, settledX, timing,
    metrics: await page.locator(".experiment-metrics").textContent(), errors };
  await writeFile(resolve(out, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  const video = page.video();
  await context.close();
  if (video) await rename(await video.path(), resolve(out, "hold-demo.webm"));
  await browser.close();
}
