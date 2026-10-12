import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const smoke = process.argv.includes("--smoke");
const manifest = JSON.parse(readFileSync(resolve("public/samples/manifest.json"), "utf8"));
if (manifest.samples.length < 4 || !existsSync(resolve("public/demo/interaction.webm")))
  throw new Error("Prepare four real samples and record the browser interaction first.");
const chrome = process.env.REMOTION_BROWSER || (process.platform === "win32" &&
  existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined);
const evidence = resolve("screenshots/submission-film");
mkdirSync(evidence, { recursive: true });
mkdirSync(resolve("public/demo"), { recursive: true });
console.log("Bundling the real sample film…");
const serveUrl = await bundle({ entryPoint: resolve("src/remotion/submission-entry.ts"),
  publicDir: resolve("public"), outDir: resolve("screenshots/submission-film/bundle") });
const composition = await selectComposition({ serveUrl, id: "IntoFrameDemo", browserExecutable: chrome });
console.log(`${composition.width}×${composition.height}, ${composition.fps} FPS, ${composition.durationInFrames / composition.fps}s`);
await renderStill({ serveUrl, composition, frame: 1500, imageFormat: "jpeg",
  browserExecutable: chrome, output: resolve(evidence, "interaction-render-check.jpg") });
const outputLocation = smoke ? resolve(evidence, "smoke.mp4") : resolve("public/demo/IntoFrame-demo.mp4");
let lastProgress = -1;
const started = Date.now();
await renderMedia({ serveUrl, composition, codec: "h264", outputLocation,
  browserExecutable: chrome, concurrency: 2, crf: 20, overwrite: true,
  ...(smoke ? { frameRange: [120, 149] } : {}),
  offthreadVideoThreads: 2,
  onProgress: ({ renderedFrames }) => {
    const step = Math.floor(renderedFrames / 150);
    if (step > lastProgress) { lastProgress = step; console.log(`Rendered ${renderedFrames} frames`); }
  },
});
if (!smoke) {
  for (const frame of [60, 240, 480, 780, 1020, 1230, 1500, 1770]) {
    await renderStill({ serveUrl, composition, frame, imageFormat: "jpeg",
      browserExecutable: chrome, output: resolve(evidence, `frame-${frame}.jpg`) });
  }
}
const bytes = readFileSync(outputLocation);
writeFileSync(resolve(evidence, smoke ? "smoke.json" : "render.json"), JSON.stringify({
  output: smoke ? "screenshots/submission-film/smoke.mp4" : "public/demo/IntoFrame-demo.mp4",
  smoke, width: composition.width, height: composition.height, fps: composition.fps,
  durationInFrames: composition.durationInFrames, bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  seconds: (Date.now() - started) / 1000,
}, null, 2));
console.log(`Finished: ${outputLocation} (${(bytes.length / 1024 / 1024).toFixed(2)} MiB)`);
