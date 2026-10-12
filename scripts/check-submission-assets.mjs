import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

const publicRoot = resolve("public");
const manifest = JSON.parse(readFileSync(resolve(publicRoot, "samples/manifest.json"), "utf8"));
assert.equal(manifest.version, 1);
assert(manifest.samples.length >= 4, "The submitted bundle requires four real examples.");
const mediaKeys = new Set(["sourceUrl", "maskUrl", "subjectUrl", "backgroundUrl", "renderBackgroundUrl",
  "renderSkyUrl", "renderSceneUrl", "editableSkyUrl", "depthUrl", "renderDepthUrl", "meshDepthUrl", "compositeUrl", "thumbnailUrl"]);
const paths = new Set();
function walk(value) {
  if (Array.isArray(value)) { value.forEach(walk);return; }
  if (!value || typeof value !== "object") return;
  for (const [key,item] of Object.entries(value)) {
    if (mediaKeys.has(key)) { assert(typeof item === "string" && item.startsWith("/samples/"));paths.add(item); }
    else walk(item);
  }
}
const ids = new Set();
for (const sample of manifest.samples) {
  assert(/^[a-z0-9-]+$/.test(sample.id) && !ids.has(sample.id));ids.add(sample.id);
  assert.equal(sample.result.id, `sample:${sample.id}`);
  assert.equal(sample.depth.jobId, sample.result.id);
  assert(sample.source.author && sample.source.license && sample.source.url && sample.source.licenseUrl);
  assert.equal(sample.result.width, sample.depth.width);
  assert.equal(sample.result.height, sample.depth.height);
  for (const style of ["dreamy-pink", "golden-hour", "cinematic-night"]) {
    assert.equal(sample.styles[style].style, style);
    assert.equal(sample.styles[style].jobId, sample.result.id);
    assert.equal(sample.styles[style].atmosphereVersion, "sky-scene-ambience-v2");
  }
  const bytes = readFileSync(resolve(publicRoot, sample.depth.meshDepthUrl.slice(1)));
  assert.equal(bytes.byteLength, sample.depth.width * sample.depth.height * 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at=0;at<bytes.length;at+=4) assert(Number.isFinite(view.getFloat32(at,true)), "Non-finite native depth");
}
walk(manifest);
const hashes = {};
for (const url of paths) {
  const path = resolve(publicRoot, url.slice(1));
  const sub = relative(publicRoot,path);
  assert(sub && !sub.startsWith(`..${sep}`) && !sub.startsWith("../") && existsSync(path), `Missing or unsafe ${url}`);
  hashes[url] = createHash("sha256").update(readFileSync(path)).digest("hex");
}
function below(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? below(resolve(path,entry.name)) : [resolve(path,entry.name)]);
}
const files = below(publicRoot).filter(path => path !== resolve(publicRoot,"samples/asset-hashes.json"));
for (const path of files) {
  assert(statSync(path).size < 95 * 1024 * 1024, `GitHub file too large: ${path}`);
  assert(!/\.(safetensors|ckpt|pth|pt|onnx)$/i.test(path), "Model weights must not be distributed");
  if (/\.json$/i.test(path)) assert(!/[A-Z]:[\\/]|\/media\/|a2bc9adae2b64a3bac527fb496439eb2/.test(readFileSync(path,"utf8")), `Local/private path in ${path}`);
}
const mp4 = resolve(publicRoot,"demo/IntoFrame-demo.mp4");
assert(existsSync(mp4), "The submitted MP4 has not been rendered.");
const report = { samples: [...ids], styles: manifest.samples.length * 3, resourceCount: paths.size,
  publicMiB: Number((files.reduce((sum,path)=>sum+statSync(path).size,0)/1024/1024).toFixed(2)),
  movieBytes: statSync(mp4).size, hashes,
};
const inventory = resolve(publicRoot,"samples/asset-hashes.json");
if (process.argv.includes("--update-hashes")) {
  writeFileSync(inventory,JSON.stringify(report,null,2));
} else {
  const saved = JSON.parse(readFileSync(inventory,"utf8"));
  assert.deepEqual(hashes,saved.hashes,"Packaged media differs from the saved submission inventory");
  assert.equal(report.movieBytes,saved.movieBytes,"Submitted video size changed");
}
mkdirSync(resolve("screenshots"),{recursive:true});
writeFileSync(resolve("screenshots/submission-asset-check.json"),JSON.stringify(report,null,2));
console.log(`Submission assets: ${ids.size} examples, ${paths.size} linked resources, ${report.publicMiB} MiB; MP4 present.`);
