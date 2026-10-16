// Screenshots of the main screens for design comparisons: node engine/scripts/design-shots.mjs <app-url> <out-dir>
import { chromium } from "playwright";
import fs from "node:fs";
const [app, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
async function login(email, pw) {
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(app, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pw);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(9000);
  return page;
}
const team = await login("ui.test@vibrant-wellness.com", "test-pass");
await team.screenshot({ path: `${out}/1-team-dashboard.png` });
await team.screenshot({ path: `${out}/2-team-dashboard-full.png`, fullPage: true });
await team.getByText("Business Feed", { exact: true }).first().click().catch(() => {});
await team.waitForTimeout(6000);
await team.screenshot({ path: `${out}/3-team-feed.png` });
await team.getByText("Rep view", { exact: true }).first().click().catch(() => {});
await team.waitForTimeout(6000);
await team.screenshot({ path: `${out}/4-team-repview.png` });
const rep = await login("madelyn.test@vibrant-wellness.com", "rep-pass-123");
await rep.getByText("Rep view", { exact: true }).first().click().catch(() => {});
await rep.waitForTimeout(5000);
await rep.getByText("Scorecard", { exact: true }).first().click().catch(() => {});
await rep.waitForTimeout(10000);
await rep.screenshot({ path: `${out}/5-rep-scorecard.png` });
await b.close();
