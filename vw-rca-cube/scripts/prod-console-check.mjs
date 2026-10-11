// Quick manual check: load the live production dashboard in a headless
// browser, log in through the gate, and report any console/page errors.
// Run with: bun run scripts/prod-console-check.mjs
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", msg => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", err => errors.push("PAGEERROR: " + err.message));

await page.goto("https://g8787y8m5ceo9wld.viktor.space/dashboard", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(2000);

const emailInput = page.locator(".rca-gate-email, input[type=email]");
if (await emailInput.count())
  await emailInput.fill("shyam@vibrant-wellness.com");
await page.locator("input[type=password].rca-gate-input").fill("vw-rca-2026");
await page.locator(".rca-gate-btn").click();
await page.waitForTimeout(8000);

console.log("=== console/page errors ===");
console.log(errors.length ? errors.join("\n---\n") : "(none)");

await page.screenshot({ path: "tmp/prod-console-check.png", fullPage: true });
await browser.close();
