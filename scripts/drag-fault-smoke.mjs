// Bounded checks for the modified native-depth gate and context-loss fallback.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:5190', origin = new URL(base).origin;
const fixture = JSON.parse(readFileSync('screenshots/depth-motion-fix/manifest.json', 'utf8')).cases.find(c => c.name === 'bigben');
const root = resolve('backend/data'), id = fixture.jobId, out = resolve('screenshots/drag-motion-fix/faults');
const sha = value => createHash('sha256').update(value).digest('hex');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const fault of ['missing-raw', 'background-context-auto', 'subject-context-drag']) {
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
    const errors = [], assets = {};
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', async response => { if (/\/assets\/.*\.js$/.test(response.url())) try { assets[new URL(response.url()).pathname] = sha(await response.body()); } catch {} });
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), path = decodeURIComponent(url.pathname);
      if (url.origin !== origin) return route.fulfill({ status: 200, contentType: url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'application/octet-stream', body: '' });
      if (path.startsWith('/api/')) {
        let response;
        if (path === '/api/jobs' && request.method() === 'POST') response = { id };
        else if (path === `/api/jobs/${id}`) response = fixture.job;
        else if (path === '/api/depth') response = { id, status: 'complete' };
        else if (path === `/api/depth/${id}`) response = fixture.depth;
        else if (path === '/api/restyle') response = { id, style: 'cinematic-night', status: 'complete' };
        else if (path === `/api/restyle/${id}/cinematic-night`) response = fixture.styles['cinematic-night'];
        return route.fulfill({ status: response ? 200 : 422, contentType: 'application/json', body: JSON.stringify(response || { detail: 'Uncaptured request blocked.' }) });
      }
      if (path.startsWith('/media/')) {
        if (fault === 'missing-raw' && path === fixture.depth.result.meshDepthUrl) return route.abort('failed');
        const file = resolve(root, path.slice('/media/'.length)), child = relative(resolve(fixture.assetDir), file);
        assert(!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`), 'Fixture media escaped sample');
        const body = readFileSync(file);
        assert.equal(sha(body), fixture.files[child.replaceAll('\\', '/')]);
        return route.fulfill({ contentType: path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'application/octet-stream', body });
      }
      return route.continue();
    });
    await page.goto(base);
    await page.locator('input[type=file]').setInputFiles(join(fixture.assetDir, 'source.webp'));
    await page.locator('.photo-stage').waitFor();
    if (fault !== 'missing-raw') {
      await page.waitForFunction(() => document.querySelector('.photo-stage')?.dataset.motionMode === 'autonomous', null, { timeout: 45000 });
      await page.getByRole('button', { name: /Cinematic Night/ }).click();
      await page.getByRole('button', { name: 'Generate background', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.subject-layer img')?.getAttribute('src')?.includes('/styles/') && document.querySelector('.photo-stage')?.dataset.motionMode === 'autonomous', null, { timeout: 45000 });
      await page.locator('.photo-stage').scrollIntoViewIfNeeded();
      if (fault.endsWith('drag')) {
        const box = await page.locator('.photo-stage').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
        await page.waitForFunction(() => document.querySelector('.photo-stage')?.dataset.motionMode === 'drag');
      }
      const target = fault.startsWith('subject') ? '.subject-depth-layer canvas' : '.spatial-canvas canvas';
      await page.locator(target).evaluate(canvas => {
        const gl = canvas.getContext('webgl2'); const extension = gl?.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('Context-loss extension unavailable'); extension.loseContext();
      });
    }
    await page.waitForFunction(() => { const stage = document.querySelector('.photo-stage'); return stage && !stage.classList.contains('spatial-ready') && stage.dataset.subjectGeometry === 'flat-fallback' && Number(stage.dataset.cameraX || 0) === 0; }, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    const state = await page.locator('.photo-stage').evaluate(stage => ({ data: { ...stage.dataset }, ready: stage.classList.contains('spatial-ready'), dragging: stage.classList.contains('is-dragging'), captured: stage.hasPointerCapture(1), subjectVisible: getComputedStyle(stage.querySelector('.subject-layer')).visibility, canvases: [...stage.querySelectorAll('canvas')].map(canvas => ({ visibility: getComputedStyle(canvas).visibility, parentDisplay: getComputedStyle(canvas.parentElement).display })), notice: document.querySelector('.phase-note')?.textContent }));
    assert.equal(state.ready, false); assert.equal(state.dragging, false); assert.equal(state.captured, false); assert.equal(state.subjectVisible, 'visible'); assert.ok(state.notice.trim().length > 0); assert.deepEqual(errors, []);
    if (fault !== 'missing-raw') assert.ok(state.canvases.every(c => c.visibility === 'hidden' || c.parentDisplay === 'none'));
    await page.locator('.photo-stage').screenshot({ path: join(out, `${fault}.png`) });
    await page.mouse.up().catch(() => {});
    results.push({ fault, passed: true, state, servedSourceSHA256: assets, errors });
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(out, 'results.json'), JSON.stringify({ passed: results.length === 3 && results.every(r => r.passed), mode: 'frozen-local-asset-faults', newInference: false, videoRecorded: false, results }, null, 2));
  console.log(JSON.stringify(results.map(r => ({ fault: r.fault, passed: r.passed }))));
}
