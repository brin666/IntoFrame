import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const base = process.env.INTOFRAME_URL || 'http://127.0.0.1:5187';
const out = resolve('screenshots/depth-motion-fix/live-upload');
mkdirSync(out,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:1360,height:1000},recordVideo:{dir:out,size:{width:1360,height:1000}}});
const page = await context.newPage();
const errors = [], requests = [];
page.on('pageerror',error => errors.push(error.message));
page.on('request',request => { if(request.url().includes('/api/')) requests.push({method:request.method(),url:request.url()}); });
const readState = () => page.locator('.photo-stage').evaluate(stage => ({cameraX:Number(stage.dataset.cameraX || 0),geometry:stage.dataset.subjectGeometry,awake:stage.classList.contains('is-awake'),interactive:stage.classList.contains('spatial-ready'),data:{...stage.dataset},status:document.querySelector('.phase-note')?.textContent}));
let record;
try {
  await page.goto(base);
  await page.locator('input[type=file]').setInputFiles(resolve('backend/data/sky-inputs/outdoor-person.png'));
  await page.waitForSelector('.photo-stage',{timeout:150000});
  await page.waitForFunction(() => document.querySelector('.photo-stage')?.dataset.subjectGeometry==='depth-mesh' && document.querySelector('.photo-stage')?.classList.contains('spatial-ready'),null,{timeout:150000});
  await page.locator('.photo-stage').scrollIntoViewIfNeeded();
  const rest=await readState();
  await page.locator('.photo-stage').screenshot({path:resolve(out,'original-rest.png')});
  const box=await page.locator('.photo-stage').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.waitForTimeout(1300);
  const hold=await readState();
  assert.equal(hold.awake,true);
  assert.ok(Math.abs(hold.cameraX)>0.001,'Real upload has actual camera motion');
  await page.locator('.photo-stage').screenshot({path:resolve(out,'original-hold.png')});
  await page.mouse.up();
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('.photo-stage')?.dataset.cameraX || 0))<0.0001 && !document.querySelector('.photo-stage')?.classList.contains('is-awake'),null,{timeout:10000});
  const settled=await readState();
  assert.equal(requests.filter(x=>x.method==='POST' && x.url.endsWith('/api/jobs')).length,1);
  assert.equal(requests.filter(x=>x.method==='POST' && x.url.endsWith('/api/depth')).length,1);
  assert.equal(requests.filter(x=>x.url.includes('/api/restyle')).length,0);
  assert.deepEqual(errors,[]);
  record={status:'passed',mode:'real-upload-and-local-inference',source:'backend/data/sky-inputs/outdoor-person.png',base,rest,hold,settled,requests,errors};
} catch(error) {
  record={status:'failed',error:error.message,requests,errors};
  await page.screenshot({path:resolve(out,'failure.png'),fullPage:true}).catch(()=>{});
  throw error;
} finally {
  writeFileSync(resolve(out,'results.json'),JSON.stringify(record,null,2));
  await context.close();
  await browser.close();
  console.log(JSON.stringify(record));
}
