import { chromium } from "playwright";
const base = "https://preview-g8787y8m5ceo9wld.viktor.space";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", err => errors.push(String(err)));

await page.goto(`${base}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
const emailInput = page.locator(".rca-gate-email, input[type=email]");
if (await emailInput.count()) await emailInput.fill("shyam@vibrant-wellness.com");
await page.locator("input[type=password].rca-gate-input").fill("vw-rca-2026");
await page.locator(".rca-gate-btn").click();
await page.waitForTimeout(8000);

// no design toggle should exist
const toggleCount = await page.locator(".rca-feed-design-toggle").count();
console.log("design toggle present (should be 0):", toggleCount);

// search
await page.locator(".rca-feed-search").fill("baseline");
await page.waitForTimeout(500);
const results = await page.locator(".rca-feed-search-results .rca-feed").count();
console.log("search results for 'baseline':", results);
await page.locator(".rca-feed-search").fill("");
await page.waitForTimeout(300);

// raise a question
await page.getByRole("button", { name: "raise a question" }).click();
await page.waitForTimeout(300);
await page.locator(".rca-feed-ask-input").fill("[TEST] Playwright automated check — please ignore.");
await page.getByRole("button", { name: /Send to #internal-test/ }).click();
await page.waitForTimeout(2500);
const sentText = await page.locator(".rca-feed-ask-actions button").innerText();
console.log("send button text after submit:", sentText);

console.log("console/page errors:", errors);
await page.screenshot({ path: "tmp/feed-search-ask.png", clip: await page.locator(".rca-feed-shelf").boundingBox() });
await browser.close();
