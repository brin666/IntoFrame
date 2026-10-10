import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const base = process.env.INTOFRAME_URL || "http://127.0.0.1:5187";
const photo = resolve(process.env.INTOFRAME_TEST_PHOTO || "backend/data/smoke/person_astronaut_source.webp");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});
mkdirSync(resolve("screenshots"), { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("input[type=file]").setInputFiles(photo);
  await page.getByText("YOUR FRAME IS READY").waitFor({ timeout: 120000 });
  await page.locator(".photo-stage").screenshot({ path: resolve("screenshots/restyle-sample-before.png") });
  await page.getByRole("button", { name: "Generate background" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".background-layer img")?.getAttribute("src")?.includes("/styles/dreamy-pink/"),
    undefined,
    { timeout: 120000 },
  );
  await page.locator(".photo-stage").screenshot({ path: resolve("screenshots/restyle-sample-after.png") });
  await page.getByRole("button", { name: "View before" }).click();
  if ((await page.locator(".background-layer img").getAttribute("src"))?.includes("/styles/")) {
    throw new Error("Before toggle still shows generated background.");
  }
  await page.getByRole("button", { name: "View after" }).click();
  await page.locator(".photo-stage.spatial-ready").waitFor({ timeout: 120000 });
  const stage = page.locator(".photo-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("Photo stage has no dimensions.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  const cameraX = Number(await stage.getAttribute("data-camera-x"));
  await page.mouse.up();
  if (!Number.isFinite(cameraX) || Math.abs(cameraX) < 0.0001)
    throw new Error("Styled scene did not animate under hold.");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  const output = resolve("screenshots/restyle-sample-export.png");
  await download.saveAs(output);
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(`Photo: generated style, before/after, camera sway, PNG export OK. cameraX=${cameraX.toFixed(5)}`);
  console.log(output);
} finally {
  await browser.close();
}
