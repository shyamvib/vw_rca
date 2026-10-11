import { chromium } from "playwright";
const base = "https://preview-g8787y8m5ceo9wld.viktor.space";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto(`${base}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
const emailInput = page.locator(".rca-gate-email, input[type=email]");
if (await emailInput.count()) await emailInput.fill("shyam@vibrant-wellness.com");
await page.locator("input[type=password].rca-gate-input").fill("vw-rca-2026");
await page.locator(".rca-gate-btn").click();
await page.waitForTimeout(6000);

await page.getByRole("button", { name: "Business Feed" }).click();
await page.waitForTimeout(2000);

// Weekly tab
await page.getByRole("button", { name: "Weekly" }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/final_weekly.png" });

// try opening the date dropdown if present
const dateSelect = page.locator("select").first();
let weeklyDateCount = null;
if (await dateSelect.count()) {
  const opts = await dateSelect.locator("option").allInnerTexts();
  weeklyDateCount = opts.length;
}

// click a history button on first card if present
const historyBtn = page.locator("button", { hasText: "History" }).first();
let historyOpened = false;
if (await historyBtn.count()) {
  await historyBtn.click();
  await page.waitForTimeout(1500);
  historyOpened = await page.locator(".rca-insight-history-modal, [class*=history]").count() > 0;
  await page.screenshot({ path: "/tmp/final_history.png" });
  // close if possible
  const closeBtn = page.locator("button", { hasText: "Close" }).first();
  if (await closeBtn.count()) await closeBtn.click();
}

// Monthly tab
await page.getByRole("button", { name: "Monthly" }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/final_monthly.png" });

console.log(JSON.stringify({ weeklyDateCount, historyOpened, errors }, null, 2));
await browser.close();
