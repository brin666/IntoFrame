// One real local GPU upload/depth run; no sky generation or video recording.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
const base = process.env.INTOFRAME_URL || 'http://127.0.0.1:5190';
const source = resolve('backend/data/sky-inputs/outdoor-person.png');
const out = resolve('screenshots/drag-motion-fix/live-upload');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
const state = () => page.locator('.photo-stage').evaluate(stage => ({ cameraX: Number(stage.dataset.cameraX || 0), target: Number(stage.dataset.cameraTargetX || 0), mode: stage.dataset.motionMode, geometry: stage.dataset.subjectGeometry, left: Number(stage.dataset.leftTravel), right: Number(stage.dataset.rightTravel) }));
let record;
try {
  await page.goto(base);
  await page.locator('input[type=file]').setInputFiles(source);
  await page.waitForFunction(() => document.querySelector('.photo-stage')?.dataset.subjectGeometry === 'depth-mesh' && document.querySelector('.photo-stage')?.dataset.motionMode === 'autonomous', null, { timeout: 180000 });
  await page.locator('.photo-stage').scrollIntoViewIfNeeded();
  const initial = await state();
  await page.waitForTimeout(1300);
  const automatic = await state();
  assert.ok(Math.abs(automatic.cameraX - initial.cameraX) > 0.0003, 'Real upload has default depth-camera motion');
  await page.locator('.photo-stage').screenshot({ path: join(out, 'original-auto.png') });
  const box = await page.locator('.photo-stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const pressed = await state();
  await page.waitForTimeout(350);
  const stationary = await state();
  assert.equal(stationary.mode, 'drag');
  assert.ok(Math.abs(stationary.cameraX - pressed.cameraX) < 0.0001, 'Press without moving freezes pose');
  await page.mouse.move(box.x + box.width * 0.77, box.y + box.height * 0.5, { steps: 15 });
  await page.waitForTimeout(800);
  const dragged = await state();
  assert.ok(dragged.cameraX < pressed.cameraX - 0.001, 'Horizontal input controls view');
  assert.ok(dragged.cameraX >= -dragged.left - 0.00002 && dragged.cameraX <= dragged.right + 0.00002, 'Drag stays within cut-safe limits');
  await page.locator('.photo-stage').screenshot({ path: join(out, 'original-drag.png') });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.photo-stage')?.dataset.motionMode === 'autonomous', null, { timeout: 12000 });
  const resumed = await state();
  assert.equal(requests.filter(x => x.method === 'POST' && x.path === '/api/jobs').length, 1);
  assert.equal(requests.filter(x => x.method === 'POST' && x.path === '/api/depth').length, 1);
  assert.equal(requests.filter(x => x.path.startsWith('/api/restyle')).length, 0);
  assert.deepEqual(errors, []);
  record = { passed: true, mode: 'real-upload-and-local-GPU-inference', base, source, sourceSHA256: createHash('sha256').update(readFileSync(source)).digest('hex'), initial, automatic, pressed, stationary, dragged, resumed, requests, errors, newSkyGeneration: false, videoRecorded: false };
} catch (error) {
  record = { passed: false, error: error.message, requests, errors };
  await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(record, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: record.passed, mode: record.mode, error: record.error, states: { initial: record.initial, automatic: record.automatic, dragged: record.dragged, resumed: record.resumed }, errors: record.errors }));
}
