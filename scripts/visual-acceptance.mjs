// Real model/API/browser evidence. Outputs stay under gitignored screenshots/.
import { chromium } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const base = process.env.INTOFRAME_URL || "http://127.0.0.1:5190";
const phase = process.env.INTOFRAME_ACCEPTANCE_PHASE || "before";
const cases = JSON.parse(readFileSync(resolve("backend/data/acceptance-inputs.json"), "utf8"));
const root = resolve("screenshots/acceptance", phase);
mkdirSync(root, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const commit = execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
const manifest = { phase, commit, timestamp: new Date().toISOString(), cases: [] };
try {
  for (const input of cases) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const started = performance.now();
    await page.goto(base, { waitUntil: "networkidle" });
    const uploadResponse = page.waitForResponse((r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST");
    await page.locator("input[type=file]").setInputFiles(input.path);
    const jobId = (await (await uploadResponse).json()).id;
    await page.getByText("YOUR FRAME IS READY").waitFor({ timeout: 180000 });
    await page.locator(".spatial-canvas canvas").waitFor({ timeout: 180000 });
    const sourceResult = (await (await page.request.get(`${base}/api/jobs/${jobId}`)).json()).result;
    const depthResult = (await (await page.request.get(`${base}/api/depth/${jobId}`)).json()).result;
    const record = { label: input.label, inputSHA256: createHash("sha256").update(readFileSync(input.path)).digest("hex"), publicAllowed: input.publicAllowed, uploadSeconds: (performance.now() - started) / 1000, sourceResult, depthResult, styles: [] };
    for (const style of input.styles) {
      const out = join(root, input.label, style);
      mkdirSync(out, { recursive: true });
      await page.getByRole("button", { name: ({"dreamy-pink":"Dreamy Pink", "golden-hour":"Golden Hour", "cinematic-night":"Cinematic Night"})[style], exact: false }).click();
      const generationStart = performance.now();
      await page.getByRole("button", { name: "Generate background", exact: true }).click();
      await page.waitForFunction((style) => document.querySelector(".background-layer img")?.getAttribute("src")?.includes(`/styles/${style}/`), style, { timeout: 240000 });
      await page.locator(".photo-stage.spatial-ready").waitFor({ timeout: 60000 });
      await page.waitForFunction(() => [...document.querySelectorAll(".photo-stage img")].every((image) => image.complete && image.naturalWidth > 0));
      const result = (await (await page.request.get(`${base}/api/restyle/${jobId}/${style}`)).json()).result;
      const generationWallSeconds = (performance.now() - generationStart) / 1000;
      for (const [name, url] of Object.entries({ source: sourceResult.sourceUrl, mask: sourceResult.maskUrl, subject: sourceResult.subjectUrl, ...(result.subjectUrl ? { styledSubject: result.subjectUrl } : {}), background: result.backgroundUrl, composite: result.compositeUrl, renderBackground: result.renderBackgroundUrl })) {
        const asset = await page.request.get(`${base}${url}`);
        if (!asset.ok()) throw new Error(`Asset ${name} failed: ${asset.status()}`);
        writeFileSync(join(out, `${name}${url.endsWith(".webp") ? ".webp" : ".png"}`), await asset.body());
      }
      await page.getByRole("button", { name: "View before", exact: true }).click();
      await page.locator(".spatial-canvas canvas").waitFor();
      await page.waitForTimeout(300);
      await page.locator(".photo-stage").screenshot({ path: join(out, "preview-before.png") });
      await page.getByRole("button", { name: "View after", exact: true }).click();
      await page.locator(".photo-stage.spatial-ready").waitFor();
      await page.waitForTimeout(300);
      await page.locator(".photo-stage").screenshot({ path: join(out, "preview-after.png") });
      await page.screenshot({ path: join(out, "browser.png"), fullPage: true });
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PNG", exact: true }).click()]);
      await download.saveAs(join(out, "export.png"));
      const geometry = await page.locator(".photo-stage").evaluate((stage) => {
        const bounds = stage.getBoundingClientRect();
        const top = stage.querySelector(".letterbox-top").getBoundingClientRect();
        const bottom = stage.querySelector(".letterbox-bottom").getBoundingClientRect();
        const foreground = stage.querySelector(".subject-layer img");
        return { width: bounds.width, height: bounds.height, topBar: top.height, bottomBar: bottom.height, cameraX: stage.dataset.cameraX, subjectURL: foreground.getAttribute("src"), backgroundMode: stage.querySelector(".spatial-canvas")?.dataset.backgroundMode || "legacy-depth", transform: getComputedStyle(stage.querySelector(".subject-layer")).transform };
      });
      const styleRecord = { style, ...result, generationWallSeconds, geometry, output: `${input.label}/${style}`, errors };
      record.styles.push(styleRecord);
      writeFileSync(join(out, "record.json"), JSON.stringify({ phase, commit, input: input.label, ...styleRecord }, null, 2));
      console.log(JSON.stringify({ input: input.label, style, size: [sourceResult.width, sourceResult.height], metrics: result.metrics, errors }));
    }
    if (errors.length) throw new Error(errors.join("; "));
    manifest.cases.push(record);
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
    await page.close();
  }
} finally {
  await browser.close();
}
