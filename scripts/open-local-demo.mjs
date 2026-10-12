// Optional local sample viewer. Uses saved real outputs; never starts inference.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `Missing --${name} value`);
  return process.argv[i + 1];
};
if (process.argv.includes('--help')) {
  console.log('node scripts/open-local-demo.mjs [--case bigben|dog|paris] [--base http://127.0.0.1:5190] [--smoke]');
  process.exit(0);
}
const base = option('base', 'http://127.0.0.1:5190').replace(/\/$/, '');
const origin = new URL(base).origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a local preview only.');
const smoke = process.argv.includes('--smoke');
const name = option('case', 'bigben');
const manifestPath = resolve('screenshots/depth-motion-fix/manifest.json');
assert(existsSync(manifestPath), 'Saved local fixture manifest is missing.');
const fixture = JSON.parse(readFileSync(manifestPath, 'utf8')).cases.find(item => item.name === name);
assert(fixture, 'Choose bigben, dog or paris.');
const mediaRoot = resolve('backend/data');
const assetRoot = resolve(fixture.assetDir);
const inside = (path, root) => { const p = relative(root, path); return p === '' || (!isAbsolute(p) && p !== '..' && !p.startsWith(`..${sep}`)); };
assert(inside(assetRoot, mediaRoot), 'Sample assets must remain in local backend data.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const types = { '.png': 'image/png', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.json': 'application/json' };
const media = new Map();
function collect(value) {
  if (typeof value === 'string' && value.startsWith('/media/')) {
    const file = resolve(mediaRoot, decodeURIComponent(value.slice('/media/'.length)));
    assert(inside(file, assetRoot), 'Captured media escaped this sample.');
    const saved = readFileSync(file), key = relative(assetRoot, file).replaceAll('\\', '/');
    assert.equal(sha(saved), fixture.files[key], `Saved sample hash changed: ${key}`);
    media.set(new URL(value, base).pathname, { body: saved, contentType: types[extname(file)] || 'application/octet-stream' });
  } else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
}
collect([fixture.job, fixture.depth, fixture.styles]);
const source = readFileSync(join(assetRoot, 'source.webp'));
assert.equal(sha(source), fixture.files['source.webp']);
console.log(`Cached local sample: ${name}. Saved real model output; no live generation timing, inference, recording or external upload.`);
const browser = await chromium.launch({ channel: 'chrome', headless: smoke });
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const requests = [], errors = [];
let initialSampleUpload = true;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()), path = decodeURIComponent(url.pathname);
  if (url.origin !== origin) return route.fulfill({ status: 200, contentType: path.endsWith('.css') || url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'application/octet-stream', body: '' });
  if (path.startsWith('/api/')) {
    requests.push({ method: request.method(), path });
    const id = fixture.jobId;
    let response, status = 200;
    if (path === '/api/jobs' && request.method() === 'POST') {
      // Only the scripted, already hash-validated sample is accepted. Chrome's
      // captured multipart metadata can omit file bytes; do not compare it to
      // a binary upload or silently accept later user-selected photos.
      if (initialSampleUpload) { initialSampleUpload = false; response = { id }; }
    } else if (path === `/api/jobs/${id}` && request.method() === 'GET') response = fixture.job;
    else if (path === '/api/depth' && request.method() === 'POST' && request.postDataJSON().jobId === id) response = { id, status: 'complete' };
    else if (path === `/api/depth/${id}` && request.method() === 'GET') response = fixture.depth;
    else if (path === '/api/restyle' && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.jobId === id && fixture.styles[body.style]) response = { id, style: body.style, status: 'complete' };
    } else if (path.startsWith(`/api/restyle/${id}/`) && request.method() === 'GET') response = fixture.styles[path.split('/').at(-1)];
    if (!response) { status = 422; response = { detail: 'This cached sample viewer only supports its saved photo and saved sky styles. Use the normal local page for a new photo.' }; }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) });
  }
  if (path.startsWith('/media/')) {
    const saved = media.get(url.pathname);
    return route.fulfill({ status: saved ? 200 : 404, ...(saved || { contentType: 'text/plain', body: 'Uncaptured media is unavailable.' }) });
  }
  return route.continue();
});
try {
  await page.goto(base);
  await page.locator('input[type=file]').setInputFiles(join(assetRoot, 'source.webp'));
  await page.waitForFunction(() => document.querySelector('.photo-stage')?.dataset.subjectGeometry === 'depth-mesh' && document.querySelector('.photo-stage')?.classList.contains('spatial-ready'), null, { timeout: 45000 });
  await page.getByRole('button', { name: /Cinematic Night/ }).click();
  await page.getByRole('button', { name: 'Generate background', exact: true }).click();
  await page.getByRole('button', { name: 'View before', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.photo-stage')?.dataset.subjectGeometry === 'depth-mesh' && document.querySelector('.photo-stage')?.classList.contains('spatial-ready'), null, { timeout: 45000 });
  await page.locator('.photo-stage').scrollIntoViewIfNeeded();
  await page.evaluate(sample => {
    document.title = `IntoFrame · cached local sample · ${sample}`;
    const note = document.createElement('div');
    note.textContent = `Cached local sample · ${sample} · saved AI sky`;
    note.setAttribute('role', 'note');
    note.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:99;padding:7px 10px;border-radius:6px;background:#171b18e8;color:#eee;font:12px system-ui;pointer-events:none';
    document.body.append(note);
  }, name);
  if (smoke) {
    await page.waitForTimeout(1000);
    assert.deepEqual(errors, []);
    const out = resolve('screenshots/drag-motion-fix/demo-smoke'); mkdirSync(out, { recursive: true });
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
    const state = await page.locator('.photo-stage').evaluate(stage => ({ ...stage.dataset }));
    writeFileSync(join(out, `${name}.json`), JSON.stringify({ passed: true, name, mode: 'cached-local-sample', newInference: false, state, requests, errors }, null, 2));
    console.log(JSON.stringify({ passed: true, name, state }));
  } else {
    console.log(`Ready at ${base}. Drag left/right, release, compare Before/After, download PNG. Close the browser to end. Other photos: rerun with --case dog or --case paris.`);
    await new Promise(resolveClosed => browser.once('disconnected', resolveClosed));
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.message, requests, pageErrors: errors, visibleMessage: await page.locator('body').innerText().catch(() => '') }));
  throw error;
} finally {
  await browser.close().catch(() => {});
}
