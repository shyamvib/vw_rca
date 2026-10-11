// Checks the redesigned business feed (main page, above Year-end
// projection): design toggle, both layouts render, collapse works, and
// there are zero console errors. Run with:
//   bun run scripts/feed-shelf-check.mjs <base-url>
import { chromium } from "playwright";

const base = process.argv[2] || "https://preview-g8787y8m5ceo9wld.viktor.space";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", msg => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", err => errors.push("PAGEERROR: " + err.message));

await page.goto(`${base}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

const emailInput = page.locator(".rca-gate-email, input[type=email]");
if (await emailInput.count()) await emailInput.fill("shyam@vibrant-wellness.com");
await page.locator("input[type=password].rca-gate-input").fill("vw-rca-2026");
await page.locator(".rca-gate-btn").click();
await page.waitForTimeout(8000);

const shelf = page.locator(".rca-feed-shelf");
console.log(
  (await shelf.count()) === 1 ? "PASS: feed shelf renders once" : "FAIL: feed shelf not found",
);

// Confirm it sits above Year-end projection (main page flow, not a fixed rail).
const shelfBox = await shelf.boundingBox();
const yearProj = page.locator(".rca-page section", { hasText: "Year-end projection" }).first();
const yearBox = await yearProj.boundingBox().catch(() => null);
if (shelfBox && yearBox) {
  console.log(
    shelfBox.y < yearBox.y
      ? "PASS: feed shelf sits above year-end projection"
      : `FAIL: feed shelf y=${shelfBox.y} not above year projection y=${yearBox.y}`,
  );
} else {
  console.log("WARN: could not locate both boxes to compare position");
}

// Design A: multi-column shelf.
await page.getByRole("button", { name: /Design A/ }).click();
await page.waitForTimeout(500);
const cols = await page.locator(".rca-feed-shelf-cols .rca-feed-col").count();
console.log(cols >= 2 ? `PASS: design A renders ${cols} columns` : "FAIL: design A columns missing");

const firstCard = page.locator(".rca-feed-shelf-cols .rca-feed").first();
const beforeBox = await firstCard.boundingBox();
await firstCard.hover();
await page.waitForTimeout(300);
const afterBox = await firstCard.boundingBox();
console.log(
  afterBox && beforeBox && afterBox.width > beforeBox.width
    ? "PASS: hovering a design-A card enlarges it"
    : "FAIL: hover enlarge not detected on design A",
);

// Design B: ticker.
await page.getByRole("button", { name: /Design B/ }).click();
await page.waitForTimeout(500);
const ticker = page.locator(".rca-feed-ticker-track");
console.log((await ticker.count()) === 1 ? "PASS: design B ticker renders" : "FAIL: ticker missing");

const tickerItem = page.locator(".rca-feed-ticker-item").first();
await tickerItem.hover({ force: true });
await page.waitForTimeout(300);
const pop = page.locator(".rca-feed-ticker-pop");
console.log((await pop.count()) === 1 ? "PASS: hovering a ticker item pops up the full card" : "FAIL: ticker hover-pop missing");

const trackClass = await ticker.getAttribute("class");
console.log(
  trackClass?.includes("is-paused")
    ? "PASS: ticker pauses on hover"
    : "FAIL: ticker did not report paused state on hover",
);

await page.getByRole("button", { name: /show all cards/ }).click();
await page.waitForTimeout(300);
const drawerCards = await page.locator(".rca-feed-ticker-drawer .rca-feed").count();
console.log(drawerCards > 0 ? `PASS: design B drawer opens with ${drawerCards} cards` : "FAIL: drawer did not open");

// Collapse vertically.
await page.getByRole("button", { name: /collapse/ }).click();
await page.waitForTimeout(300);
const expandBtn = page.getByRole("button", { name: /expand ▼/ });
console.log((await expandBtn.count()) === 1 ? "PASS: collapses to a header-only strip" : "FAIL: collapse control missing");
await expandBtn.click();

console.log("=== console/page errors ===");
console.log(errors.length ? errors.join("\n---\n") : "(none)");

await page.screenshot({ path: "tmp/feed-shelf-check.png", fullPage: false });
await browser.close();
