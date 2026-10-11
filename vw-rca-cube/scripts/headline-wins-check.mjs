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
await page.waitForTimeout(9000);

const h1 = await page.locator(".rca-hero-copy h1").innerText();
console.log("HEADLINE:", h1);
console.log("console/page errors:", errors);
await page.locator(".rca-hero").screenshot({ path: "tmp/headline-check.png" });
await browser.close();
