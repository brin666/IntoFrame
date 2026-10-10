import { chromium } from "playwright";
import { resolve } from "node:path";
const base = process.env.INTOFRAME_URL || "http://127.0.0.1:5187/";

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
  for (const [category, name] of [
    ["person", "person_astronaut"],
    ["pet", "pet_chelsea"],
    ["object", "object_coffee"],
  ]) {
    await page.goto(base, { waitUntil: "networkidle" });
    await page
      .locator("input[type=file]")
      .setInputFiles(resolve(`backend/data/smoke/${name}_source.webp`));
    await page.getByText("YOUR FRAME IS READY").waitFor({ timeout: 120000 });
    await page.waitForFunction(() => {
      const source = document.querySelector(".background-layer img");
      const subject = document.querySelector(".subject-layer img");
      return (
        source instanceof HTMLImageElement &&
        subject instanceof HTMLImageElement &&
        source.complete &&
        subject.complete &&
        source.naturalWidth > 0 &&
        subject.naturalWidth > 0
      );
    });
    const noticeCount = await page.locator(".composition-notice").count();
    if (category === "pet" && noticeCount !== 1)
      throw new Error("Edge-cropped pet should show composition guidance");
    await page.screenshot({
      path: resolve(`screenshots/preview-${category}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Adjust frame" }).click();
    await page.locator("input[type=range]").fill("1.3");
    await page.getByRole("button", { name: "View mask" }).click();
    await page.waitForFunction(() => {
      const image = document.querySelector(".mask-layer img");
      return (
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0
      );
    });
    console.log(`${category}: preview, zoom and mask inspection OK`);
  }
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile
    .locator("input[type=file]")
    .setInputFiles(resolve("backend/data/smoke/object_coffee_source.webp"));
  await mobile.getByText("YOUR FRAME IS READY").waitFor({ timeout: 120000 });
  const overflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (overflow > 1)
    throw new Error(`Mobile horizontal overflow: ${overflow}px`);
  await mobile.screenshot({
    path: resolve("screenshots/preview-mobile.png"),
    fullPage: true,
  });
  console.log("mobile: no horizontal overflow");
  if (errors.length) throw new Error(`Browser error: ${errors.join("; ")}`);
  console.log(
    "Browser upload → AI result → preview: OK for all three categories",
  );
} finally {
  await browser.close();
}
