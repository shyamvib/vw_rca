import { chromium } from "playwright";

const base = process.env.APP_URL || "https://preview-g8787y8m5ceo9wld.viktor.space";
const browser = await chromium.launch();
const errors = [];
async function login(email, password) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password].rca-gate-input").fill(password);
  await page.locator(".rca-gate-btn").click();
  await page.locator(".rca-hero-copy h1").waitFor({ timeout: 45000 });
  return page;
}
try {
  const rep = await login("viktor.test@vibrant-wellness.com", "preview-test-9f3k");
  const team = await login("shyam@vibrant-wellness.com", "vw-rca-2026");
  const before = await team.locator(".rca-hero-kpis").innerText();
  const startDate = process.env.START_DATE || "2026-05-01";
  await rep.getByLabel("Window starts").fill(startDate);
  await rep.getByLabel("Window ends").fill("2026-09-23");
  const t = Date.now();
  await rep.getByRole("button", { name: "Apply", exact: true }).first().click();
  await rep.locator(".rca-rep-calc").waitFor({ timeout: 20000 });
  await team.waitForTimeout(2200);
  const teamDuring = await team.locator(".rca-hero-kpis").innerText();
  const teamBusy = await team.locator(".rca-root").getAttribute("aria-busy");
  const repStatus = await rep.locator(".rca-rep-calc").innerText();
  await rep.locator(".rca-rep-calc").waitFor({ state: "hidden", timeout: 240000 });
  const seconds = Math.round((Date.now() - t) / 1000);
  await rep.getByRole("button", { name: "Weekly" }).click();
  const bar = rep.locator(".rca-bar-slot").first();
  const barLabel = await bar.locator(".rca-bar-label").innerText();
  await bar.click();
  await rep.waitForTimeout(500);
  const title = await rep.locator(".rca-hero-copy h1").innerText();
  const topDate = await rep.locator(".rca-topbar .rca-dim").innerText();
  const kpis = await rep.locator(".rca-hero-kpis").innerText();
  console.log(JSON.stringify({ seconds, teamBusy, teamUnchanged: before === teamDuring, repStatus, barLabel, title, topDate, kpis, errors }, null, 2));
  if (teamBusy !== "false" || before !== teamDuring || !title.includes("May 1 – May 3:") || !topDate.includes("MAY 1") || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
