// Opens a scorecard metric's clinic list, expands the first clinic, screenshots the card.
import { chromium } from "playwright";
const [app, shot] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1400 } });
await p.goto(app, { waitUntil: "networkidle" });
await p.fill('input[type="email"]', "madelyn.test@vibrant-wellness.com");
await p.fill('input[type="password"]', "rep-pass-123");
await p.keyboard.press("Enter");
await p.waitForTimeout(7000);
await p.getByText("Scorecard", { exact: true }).first().click();
await p.waitForTimeout(8000);
await p.locator(".rv-mx-c.rv-click", { hasText: "Customer churn" }).first().click();
await p.waitForTimeout(4500);
await p.locator("#sc-cl table tbody tr").nth(2).click();
await p.waitForTimeout(5000);
await p.locator("#sc-cl").scrollIntoViewIfNeeded();
await p.screenshot({ path: shot });
await b.close();
