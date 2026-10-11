import { chromium } from "playwright";
const base = "https://preview-g8787y8m5ceo9wld.viktor.space";
const b = await chromium.launch(); const errors=[];
const page = await b.newPage({ viewport: { width: 1500, height: 1100 } });
page.on("pageerror", e => errors.push(String(e))); page.on("console", m => { if (m.type()==="error") errors.push(m.text()); });
await page.goto(`${base}/dashboard`);
await page.locator("input[type=email]").fill("viktor.test@vibrant-wellness.com");
await page.locator("input[type=password].rca-gate-input").fill("preview-test-9f3k");
await page.locator(".rca-gate-btn").click();
await page.locator(".rca-hero-copy h1").waitFor({ timeout: 60000 });
await page.getByRole("button",{name:"Rep view"}).click();
await page.locator(".rv-h1").waitFor({timeout:60000});

for (const t of ["Today","This week","This month","Custom","Scorecard"]) {
  await page.locator(".rv-nav button",{hasText:t}).click(); await page.waitForTimeout(4500);
  await page.screenshot({path:`/work/temp/rv3_${t.replace(/\s/g,'_')}.png`,fullPage:true});
}

// Rail leaderboard label follows the tab
await page.locator(".rv-nav button",{hasText:"This month"}).click(); await page.waitForTimeout(2500);
console.log("RAIL(month):", (await page.locator(".rv-rail-lb-wrap .rv-eyebrow").innerText()).trim());
await page.locator(".rv-nav button",{hasText:"Custom"}).click(); await page.waitForTimeout(2500);
console.log("RAIL(custom):", (await page.locator(".rv-rail-lb-wrap .rv-eyebrow").innerText()).trim());

// Today: health + portfolio-status chips, stuck-window chips, clinic drawer
await page.locator(".rv-nav button",{hasText:"Today"}).click(); await page.waitForTimeout(2000);
const chipRows = page.locator(".rv-chips");
console.log("chip rows on Today:", await chipRows.count());
const pstatusChip = chipRows.nth(1).locator("button").nth(1);
if (await pstatusChip.count()) { await pstatusChip.click(); await page.waitForTimeout(1500); await page.screenshot({path:"/work/temp/rv3_today_pstatus.png"}); }
const stuckChip = page.locator(".rv-chips-tight button", { hasText: "21" }).first();
if (await stuckChip.count()) { await stuckChip.click(); await page.waitForTimeout(1500); await page.screenshot({path:"/work/temp/rv3_stuck_window.png"}); }
const card = page.locator(".rv-card-click").first();
if (await card.count()) {
  await card.click(); await page.waitForTimeout(2000);
  await page.screenshot({path:"/work/temp/rv3_clinic_drawer.png"});
  await page.locator(".rv-modal-x").click(); await page.waitForTimeout(500);
}

// This week: shortfall tree — simplified click, then toggle to exact + inline table
await page.locator(".rv-nav button",{hasText:"This week"}).click(); await page.waitForTimeout(3000);
const lensRow = page.locator(".rv-lens-row-click").first();
if (await lensRow.count()) {
  await lensRow.click(); await page.waitForTimeout(2000);
  await page.screenshot({path:"/work/temp/rv3_focus_table_simplified.png",fullPage:true});
}
const toggle = page.locator(".rv-toggle-btn");
if (await toggle.count()) {
  await toggle.click(); await page.waitForTimeout(1500);
  await page.screenshot({path:"/work/temp/rv3_tree_exact.png",fullPage:true});
  const exactLensRow = page.locator(".rca-lens-row").first();
  if (await exactLensRow.count()) {
    await exactLensRow.click(); await page.waitForTimeout(2000);
    await page.screenshot({path:"/work/temp/rv3_focus_table_exact.png",fullPage:true});
  }
}

// Great Job banner visible + labelled
console.log("Great Job banner present:", await page.locator(".rv-great-job").count());

// Thermometer legend (no overlap check — just confirm rows render)
console.log("Thermo legend rows:", await page.locator(".rv-thermo-row").count());

// Scorecard: Product Growth pillar -> family list
await page.locator(".rv-nav button",{hasText:"Scorecard"}).click(); await page.waitForTimeout(3000);
await page.locator(".rv-mx-row",{hasText:"Product Growth"}).click(); await page.waitForTimeout(2000);
await page.screenshot({path:"/work/temp/rv3_product_growth.png",fullPage:true});

console.log("ERR",errors.slice(0,15)); await b.close();
