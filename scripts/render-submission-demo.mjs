import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const smoke = process.argv.includes("--smoke");
const stillsOnly = process.argv.includes("--stills");
const manifest = JSON.parse(readFileSync(resolve("public/samples/manifest.json"), "utf8"));
if (manifest.samples.filter(s => s.category === "architecture").length < 3 ||
  !["workflow.webm", "architecture-interaction.webm"].every(name => existsSync(resolve("public/demo", name))))
  throw new Error("Prepare at least three real buildings and both browser recordings first.");
const chrome = process.env.REMOTION_BROWSER || (process.platform === "win32" &&
  existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined);
const evidence = resolve("screenshots/submission-film");
mkdirSync(evidence, { recursive: true });
mkdirSync(resolve("public/demo"), { recursive: true });
console.log("Bundling the real architecture film…");
const serveUrl = await bundle({ entryPoint: resolve("src/remotion/submission-entry.ts"),
  publicDir: resolve("public"), outDir: resolve("screenshots/submission-film/bundle") });
const composition = await selectComposition({ serveUrl, id: "IntoFrameDemo", browserExecutable: chrome });
if (composition.durationInFrames !== 4500 || composition.fps !== 30) throw new Error("Unexpected submission duration");
console.log(`${composition.width}×${composition.height}, ${composition.fps} FPS, ${composition.durationInFrames / composition.fps}s`);
const keyframes = [60, 600, 1320, 1500, 1740, 1950, 2130, 2340, 2580, 2820, 3060, 3300, 3540, 3780, 4200];
// Check every chapter before spending time on a full render.
for (const frame of keyframes) {
  await renderStill({ serveUrl, composition, frame, imageFormat: "jpeg",
    browserExecutable: chrome, output: resolve(evidence, `frame-${frame}.jpg`) });
  console.log(`Checked still ${frame}`);
}
if (stillsOnly) process.exit(0);
const outputLocation = resolve(evidence, smoke ? "smoke.mp4" : "IntoFrame-demo-candidate.mp4");
let lastProgress = -1;
const started = Date.now();
await renderMedia({ serveUrl, composition, codec: "h264", outputLocation,
  browserExecutable: chrome, concurrency: 2, crf: 20, overwrite: true,
  ...(smoke ? { frameRange: [3420, 3449] } : {}),
  offthreadVideoThreads: 2,
  onProgress: ({ renderedFrames }) => {
    const step = Math.floor(renderedFrames / 150);
    if (step > lastProgress) { lastProgress = step; console.log(`Rendered ${renderedFrames} frames`); }
  },
});
const ffprobe = process.platform === "win32"
  ? resolve("node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe") : "ffprobe";
const probe = spawnSync(ffprobe, ["-v", "error", "-count_frames", "-show_entries",
  "format=duration:stream=codec_name,width,height,r_frame_rate,nb_read_frames", "-of", "json", outputLocation], { encoding: "utf8" });
if (probe.status !== 0) throw new Error(probe.stderr);
const media = JSON.parse(probe.stdout);
if (!smoke && (Number(media.format.duration) !== 150 || Number(media.streams[0].nb_read_frames) !== 4500))
  throw new Error("Encoded MP4 does not meet the 150-second / 4500-frame contract");
const published = resolve("public/demo/IntoFrame-demo.mp4");
if (!smoke) {
  if (existsSync(published) && !existsSync(resolve(evidence, "previous-63s.mp4")))
    copyFileSync(published, resolve(evidence, "previous-63s.mp4"));
  copyFileSync(outputLocation, published);
}
const bytes = readFileSync(outputLocation);
writeFileSync(resolve(evidence, smoke ? "smoke.json" : "render.json"), JSON.stringify({
  output: smoke ? "screenshots/submission-film/smoke.mp4" : "public/demo/IntoFrame-demo.mp4",
  smoke, width: composition.width, height: composition.height, fps: composition.fps,
  durationInFrames: composition.durationInFrames, durationSeconds: Number(media.format.duration), bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  renderSeconds: (Date.now() - started) / 1000, probe: media, keyframes,
}, null, 2));
console.log(`Finished: ${outputLocation} (${(bytes.length / 1024 / 1024).toFixed(2)} MiB)`);
