// Checks the pos/neg driver split renders inline on a cohort tree branch,
// and that each side's info icon opens the clinic drill scoped to just that
// side (beating baseline vs missing baseline) — two separate lists, not the
// combined cohort list. Run with: bun run scripts/cohort-tree-split-check.mjs [url]
import { chromium } from "playwright";

const url = process.argv[2] || "https://preview-g8787y8m5ceo9wld.viktor.space";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1400 } });
const errors = [];
page.on("console", msg => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", err => errors.push("PAGEERROR: " + err.message));

await page.goto(`${url}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);

const emailInput = page.locator(".rca-gate-email, input[type=email]");
if (await emailInput.count()) await emailInput.fill("shyam@vibrant-wellness.com");
await page.locator("input[type=password].rca-gate-input").fill("vw-rca-2026");
await page.locator(".rca-gate-btn").click();
await page.waitForTimeout(8000);

if (!(await page.locator(".rca-topbar").count())) {
  console.log("FAIL: dashboard did not unlock");
  await browser.close();
  process.exit(1);
}

const cohortCard = page.locator(".rca-lens", { hasText: "Clinic cohort" });
await cohortCard.scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);

const inlineSplit = cohortCard.locator(".rca-lens-split").first();
if (!(await inlineSplit.count())) {
  console.log("FAIL: no inline pos/neg split rendered on any cohort branch");
  await page.screenshot({ path: "tmp/cohort-tree-split-fail.png", fullPage: true });
  await browser.close();
  process.exit(1);
}
const splitText = (await inlineSplit.innerText()).replace(/\n/g, " | ");
console.log("PASS: inline split text ->", splitText);
await inlineSplit.scrollIntoViewIfNeeded();
await page.screenshot({ path: "tmp/cohort-tree-split-inline.png" });

const icons = inlineSplit.locator(".rca-info-icon");
const iconCount = await icons.count();
if (iconCount !== 2) {
  console.log(`FAIL: expected 2 info icons (beating + missing), found ${iconCount}`);
  await browser.close();
  process.exit(1);
}
console.log("PASS: found 2 info icons (beating side + missing side)");

// Click the first (beating) icon.
await icons.nth(0).click();
await page.waitForTimeout(2000);
let title = await page.locator(".rca-drill-title").innerText();
if (!/beating baseline/i.test(title)) {
  console.log("FAIL: beating icon did not scope to beating baseline ->", title);
  await browser.close();
  process.exit(1);
}
let sub = await page.locator(".rca-drill .rca-sub").first().innerText();
console.log("PASS: beating icon drill ->", title, "|", sub);
await page.screenshot({ path: "tmp/cohort-tree-split-beating.png", fullPage: true });

// Click the second (missing) icon — re-locate since drill panel re-renders.
const iconsAgain = inlineSplit.locator(".rca-info-icon");
await iconsAgain.nth(1).click();
await page.waitForTimeout(2000);
title = await page.locator(".rca-drill-title").innerText();
if (!/missing baseline/i.test(title)) {
  console.log("FAIL: missing icon did not scope to missing baseline ->", title);
  await browser.close();
  process.exit(1);
}
sub = await page.locator(".rca-drill .rca-sub").first().innerText();
console.log("PASS: missing icon drill ->", title, "|", sub);
await page.screenshot({ path: "tmp/cohort-tree-split-missing.png", fullPage: true });

console.log("=== console/page errors ===");
console.log(errors.length ? errors.join("\n---\n") : "(none)");

await browser.close();
