import { chromium } from "playwright";
const base = "https://preview-g8787y8m5ceo9wld.viktor.space";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
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

await page.getByRole("button", { name: "Weekly" }).click();
await page.waitForTimeout(3000);

const dotsCount = await page.locator(".rca-insight-timeline-dot").count();
const trendCount = await page.locator(".rca-insight-timeline-trend").count();
const changedCount = await page.locator(".rca-insight-timeline-changed").count();
console.log("weekly dots:", dotsCount, "trends:", trendCount, "changed badges:", changedCount);
await page.screenshot({ path: "/tmp/weekly_timeline.png", fullPage: false });

await page.getByRole("button", { name: "Monthly" }).click();
await page.waitForTimeout(3000);
const dotsCountM = await page.locator(".rca-insight-timeline-dot").count();
console.log("monthly dots:", dotsCountM);
await page.screenshot({ path: "/tmp/monthly_timeline.png", fullPage: false });

console.log("console errors:", errors.slice(0, 10));
await browser.close();
