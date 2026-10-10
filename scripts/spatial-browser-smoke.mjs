import { chromium } from "playwright";
import { resolve } from "node:path";
const BASE_URL = process.env.INTOFRAME_URL || "http://127.0.0.1:5187/";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page
    .locator("input[type=file]")
    .setInputFiles(resolve("backend/data/smoke/person_astronaut_source.webp"));
  await page
    .locator(".photo-stage.spatial-ready canvas")
    .waitFor({ timeout: 180000 });
  const stage = page.locator(".photo-stage");
  const top = await page
    .locator(".letterbox-top")
    .evaluate((element) => Number(getComputedStyle(element).zIndex));
  const subject = await page
    .locator(".subject-layer")
    .evaluate((element) => Number(getComputedStyle(element).zIndex));
  if (subject <= top) throw new Error("Foreground must remain above letterbox");
  await page.screenshot({
    path: resolve("screenshots/spatial-rest.png"),
    fullPage: true,
  });
  const box = await stage.boundingBox();
  if (!box) throw new Error("Missing photo stage");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1800);
  const x1 = Number(await stage.getAttribute("data-camera-x"));
  await page.waitForTimeout(850);
  const x2 = Number(await stage.getAttribute("data-camera-x"));
  if (Math.abs(x1) < 0.001 && Math.abs(x2) < 0.001)
    throw new Error("Camera did not move on hold");
  if (Math.abs(x1 - x2) < 0.001)
    throw new Error("Camera did not sway over time");
  await page.screenshot({
    path: resolve("screenshots/spatial-alive.png"),
    fullPage: true,
  });
  const timing = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let start;
        function frame(now) {
          if (start === undefined) start = now;
          times.push(now);
          if (now - start < 2000) requestAnimationFrame(frame);
          else {
            const intervals = times
              .slice(1)
              .map((value, index) => value - times[index])
              .sort((a, b) => a - b);
            resolve({
              fps: Math.round(
                ((times.length - 1) * 1000) / (times.at(-1) - times[0]),
              ),
              p95Ms: Number(
                intervals[Math.floor(intervals.length * 0.95)].toFixed(2),
              ),
            });
          }
        }
        requestAnimationFrame(frame);
      }),
  );
  await page.mouse.up();
  await page.waitForTimeout(2200);
  const settled = Number(await stage.getAttribute("data-camera-x"));
  if (Math.abs(settled) > 0.002)
    throw new Error(`Camera did not settle: ${settled}`);
  await page.screenshot({
    path: resolve("screenshots/spatial-settled.png"),
    fullPage: true,
  });
  for (const [category, sample] of [
    ["pet", "pet_chelsea"],
    ["object", "object_coffee"],
  ]) {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page
      .locator("input[type=file]")
      .setInputFiles(resolve(`backend/data/smoke/${sample}_source.webp`));
    await page
      .locator(".photo-stage.spatial-ready canvas")
      .waitFor({ timeout: 120000 });
    const stageBox = await page.locator(".photo-stage").boundingBox();
    if (!stageBox) throw new Error(`${category}: missing photo stage`);
    await page.mouse.move(
      stageBox.x + stageBox.width / 2,
      stageBox.y + stageBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(1300);
    const movement = Number(
      await page.locator(".photo-stage").getAttribute("data-camera-x"),
    );
    if (Math.abs(movement) < 0.001)
      throw new Error(`${category}: no camera motion`);
    await page.screenshot({
      path: resolve(`screenshots/spatial-${category}.png`),
      fullPage: true,
    });
    await page.mouse.up();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByText("Motion is reduced in your system settings.", { exact: false })
    .waitFor();
  const reducedBox = await page.locator(".photo-stage").boundingBox();
  if (!reducedBox) throw new Error("Reduced-motion stage missing");
  await page.mouse.move(
    reducedBox.x + reducedBox.width / 2,
    reducedBox.y + reducedBox.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(1000);
  const reducedCameraX = Number(
    await page.locator(".photo-stage").getAttribute("data-camera-x"),
  );
  await page.mouse.up();
  if (Math.abs(reducedCameraX) > 0.001)
    throw new Error(`Reduced-motion camera moved: ${reducedCameraX}`);
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(BASE_URL, { waitUntil: "networkidle" });
  await mobile
    .locator("input[type=file]")
    .setInputFiles(resolve("backend/data/smoke/object_coffee_source.webp"));
  await mobile
    .locator(".photo-stage.spatial-ready canvas")
    .waitFor({ timeout: 120000 });
  const mobileOverflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (mobileOverflow > 1) throw new Error(`Mobile overflow: ${mobileOverflow}`);
  const touchBox = await mobile.locator(".photo-stage").boundingBox();
  if (!touchBox) throw new Error("Mobile photo stage missing");
  const touchSession = await mobile.context().newCDPSession(mobile);
  const touchPoint = {
    x: Math.round(touchBox.x + touchBox.width / 2),
    y: Math.round(touchBox.y + touchBox.height / 2),
  };
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touchPoint],
  });
  await mobile.waitForTimeout(1300);
  const touchMove = Number(
    await mobile.locator(".photo-stage").getAttribute("data-camera-x"),
  );
  if (Math.abs(touchMove) < 0.001)
    throw new Error("Touch hold did not animate");
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await mobile.screenshot({
    path: resolve("screenshots/spatial-mobile.png"),
    fullPage: true,
  });
  if (errors.length) throw new Error(errors.join("; "));
  console.log(
    JSON.stringify({
      status: "ok",
      cameraDuringHold: [x1, x2],
      settled,
      headlessChrome: timing,
      subjectAboveBar: true,
      mobileTouchCameraX: touchMove,
      mobileOverflow,
      reducedCameraX,
    }),
  );
} finally {
  await browser.close();
}
