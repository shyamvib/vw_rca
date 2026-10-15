// Business Feed "stopped Gut Zoomer / Total Tox" card -> clinic list (famstops focus).
//   bun run scripts/famstops-check.mjs <base-url>
import { chromium } from "playwright";
const base = process.argv[2] || "https://preview-g8787y8m5ceo9wld.viktor.space";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
await page.goto(`${base}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
const emailInput = page.locator("input[type=email].rca-gate-input");
if (await emailInput.count()) await emailInput.fill("shyam@vibrant-wellness.com");
await page.locator("input[type=password].rca-gate-input").fill(process.env.RCA_PW);
await page.locator(".rca-gate-btn").click();
await page.waitForTimeout(9000);
await page.locator(".rca-feed-search").first().fill("Gut Zoomer");
await page.waitForTimeout(800);
const card = page.locator(".rca-feed-search-results .rca-feed", { hasText: "stopped ordering Gut Zoomer" }).first();
console.log("card:", await card.count());
await card.scrollIntoViewIfNeeded();
await card.click();
await page.waitForTimeout(6000);
const drill = page.locator(".rca-drill", { hasText: "Gut Zoomer / Total Tox" }).first();
console.log("drill:", await drill.count());
await drill.scrollIntoViewIfNeeded();
const rows = () => drill.locator("tbody > tr:not(.rca-subrow)").count();
console.log("rows all:", await rows());
console.log("sub:", (await drill.locator(".rca-sub").first().innerText()).slice(0, 160));
await page.screenshot({ path: "/tmp/fs_list.png" });
await drill.locator(".rca-stop-chips .rca-tab", { hasText: "Gut Zoomer" }).click();
await drill.locator(".rca-stop-chips .rca-tab", { hasText: "May" }).click();
await page.waitForTimeout(500);
console.log("rows May GZ:", await rows());
await drill.locator(".rca-stop-chips .rca-tab", { hasText: "All" }).click();
await drill.locator(".rca-stop-chips .rca-tab", { hasText: "Both" }).click();
for (const col of ["State", "Days since", "Days since", "Clinic", "Expected"]) {
  await drill.locator("th.rca-th-sort", { hasText: col }).first().click();
  await page.waitForTimeout(300);
  console.log(`sort ${col}:`, (await drill.locator("tbody > tr").first().innerText()).replace(/\s+/g, " ").slice(0, 200));
}
await drill.screenshot({ path: "/tmp/fs_sort.png" });
console.log("errors:", errors.slice(0, 5));
await browser.close();
