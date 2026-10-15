// Drives the real dashboard in headless Chromium against the analytics service + a Convex deployment.
//   node engine/scripts/ui-smoke.mjs <app-url> <out-dir> [email] [password]
import { chromium } from "playwright";
import fs from "node:fs";
const [app, out, email = "ui.test@vibrant-wellness.com", password = "vw-rca-2026"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const reqs = { service: {}, convex: 0, failed: [] };
page.on("request", r => {
  const u = r.url();
  if (u.includes(":8787/rpc")) {
    try { const n = JSON.parse(r.postData() || "{}").name; reqs.service[n] = (reqs.service[n] || 0) + 1; } catch {}
  }
});
page.on("websocket", () => { reqs.convex++; });
page.on("response", async r => { if (r.url().includes(":8787/rpc") && r.status() >= 400) reqs.failed.push(`${r.status()} ${(await r.text()).slice(0, 120)}`); });
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
await page.goto(app, { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/1-gate.png` });
await page.fill('input[type="email"]', email);
await page.fill('input[type="password"]', password);
await page.click("button.rca-gate-btn, button:has-text('Unlock'), button:has-text('Enter'), button:has-text('Sign')").catch(async () => { await page.keyboard.press("Enter"); });
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/2-dashboard.png`, fullPage: false });
const text = (await page.locator("body").innerText()).slice(0, 600).replace(/\s+/g, " ");
console.log("page text:", text);
console.log("service calls:", JSON.stringify(reqs.service));
console.log("convex websockets opened:", reqs.convex, "| failed service calls:", JSON.stringify(reqs.failed), "| page errors:", JSON.stringify(errors));
await browser.close();
