import { chromium } from "playwright";

const appUrl = process.env.APP_URL;
if (!appUrl) throw new Error("APP_URL must be set");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 980, height: 760 } });

try {
  await page.goto(appUrl);
  await page.waitForSelector(".rca-gate-card");
  const inputs = await page.locator(".rca-gate-input").all();
  await inputs[0].fill("test@vibrant-wellness.com");
  await inputs[1].fill("not-the-password");
  await page.locator(".rca-gate-btn").click();
  await page.waitForSelector(".rca-gate-error");

  const error = await page.locator(".rca-gate-error").textContent();
  if (error !== "That password is not right.") {
    throw new Error(`expected password error; got ${error ?? "nothing"}`);
  }
  console.log("sandboxed iframe button click completed without allow-forms");
} finally {
  await browser.close();
}
