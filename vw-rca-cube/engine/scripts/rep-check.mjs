// Rep login shows only the Rep view; team Settings loads the rep-names dropdown without errors.
import { chromium } from "playwright";
const [app, out] = process.argv.slice(2);
const b = await chromium.launch();
async function login(email, pw) {
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [], calls = {};
  page.on("pageerror", e => errs.push(String(e).slice(0, 160)));
  page.on("request", r => { if (r.url().includes(":8787/rpc")) { const n = JSON.parse(r.postData() || "{}").name; calls[n] = (calls[n] || 0) + 1; } });
  await page.goto(app, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pw);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(9000);
  return { page, errs, calls };
}
const rep = await login("madelyn.test@vibrant-wellness.com", "rep-pass-123");
const t = await rep.page.locator("body").innerText();
console.log("REP: has Business Feed tab:", /Business Feed/i.test(t), "| has Dashboard tab:", /^\s*dashboard\s*$/im.test(t), "| viewing:", /Viewing .* book/.test(t), "| errors:", JSON.stringify(rep.errs));
console.log("REP calls:", JSON.stringify(rep.calls));
await rep.page.screenshot({ path: `${out}/rep-only.png` });
const team = await login("ui.test@vibrant-wellness.com", "test-pass");
await team.page.getByText("Settings", { exact: false }).first().click();
await team.page.waitForTimeout(2500);
const adm = team.page.locator('input[type="password"]').first();
if (await adm.count()) { await adm.fill("test-pass"); await team.page.keyboard.press("Enter"); await team.page.waitForTimeout(4000); }
await team.page.screenshot({ path: `${out}/team-settings.png` });
console.log("TEAM settings errors:", JSON.stringify(team.errs), "| repNames served:", team.calls["repAuth:repNames"] ?? 0);
await b.close();
