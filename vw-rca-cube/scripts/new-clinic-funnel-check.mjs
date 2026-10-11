import { chromium } from "playwright";

const base = process.env.APP_URL || "https://preview-g8787y8m5ceo9wld.viktor.space";
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  if (await page.locator(".rca-gate-input").count()) {
    await page.locator('input[type="email"].rca-gate-input').fill("shyam@vibrant-wellness.com");
    await page.locator('input[type="password"].rca-gate-input').fill("vw-rca-2026");
    await page.locator(".rca-gate-btn").click();
  }
  await page.locator(".rca-new-clinic-funnel").waitFor({ timeout: 60000 });
  const funnel = page.locator(".rca-new-clinic-funnel");
  const rows = funnel.locator(".rca-fam-row");
  const labels = await rows.allInnerTexts();
  if (!labels.some(text => text.includes("Did not place order 2"))) throw new Error("drop-off stage missing");
  if (!labels.some(text => text.includes("Did not place order 3")) ||
      !labels.some(text => text.includes("Did not place order 4")) ||
      !labels.some(text => text.includes("Order 4"))) {
    throw new Error("funnel through order 4 is incomplete");
  }
  const drop = rows.filter({ hasText: "Did not place order 2" });
  const dropText = await drop.innerText();
  const dropCount = Number(dropText.match(/[\d,]+ clinics/)?.[0].replace(/[^\d]/g, ""));
  const order1Text = await rows.filter({ hasText: /^Order 1/ }).first().innerText();
  const order2Text = await rows.filter({ hasText: /^Order 2/ }).first().innerText();
  const order3Text = await rows.filter({ hasText: /^Order 3/ }).first().innerText();
  const order4Text = await rows.filter({ hasText: /^Order 4/ }).first().innerText();
  await drop.click();
  const drill = page.locator(".rca-drill");
  await drill.waitFor({ timeout: 10000 });
  await page.waitForFunction(() => {
    const text = document.querySelector(".rca-drill .rca-sub")?.textContent || "";
    return text.includes("reached order 1 but did not reach order 2") || text.includes("Loading clinic detail");
  }, undefined, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const summary = await drill.locator(".rca-sub").first().innerText();
  const tableRows = drill.locator(".rca-table tbody tr");
  const listed = await tableRows.count();
  const displayedOrders = await tableRows.locator("td").nth(7).allInnerTexts();
  const allOneOrder = displayedOrders.every(text =>
    /^1(?:\.0)?\s+vs\s+0(?:\.0)?$/.test(text.trim()),
  );
  const result = { url: base, labels, order1: order1Text, dropOff: dropText, order2: order2Text, order3: order3Text, order4: order4Text, drillSummary: summary, dropCount, listed, allOneOrder, errors };
  console.log(JSON.stringify(result, null, 2));
  if (!dropCount || !summary.includes("reached order 1 but did not reach order 2") || !listed || !allOneOrder || errors.length) process.exitCode = 1;
  await page.screenshot({ path: "tmp/new-clinic-dropoff-preview.png", fullPage: true });
} finally {
  await browser.close();
}
