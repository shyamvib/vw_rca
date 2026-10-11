import { runTest } from "./auth";

// Business feed scoped to a team lead — added 2026-09-06 per Shyam's ask to
// add RCA questions to the feed and reference them from the deck instead of
// exporting a separate spreadsheet.
runTest("Business feed scopes to a team lead", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(1500);
  if (await page.locator(".rca-gate-input").count()) {
    await page.locator('input[type="email"].rca-gate-input').fill("qa@vibrant-wellness.com");
    await page.locator('input[type="password"].rca-gate-input').fill("vw-rca-2026");
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(4000);
  await page.setViewportSize({ width: 1600, height: 1400 });

  // Open the Business feed rail and confirm it is unscoped by default.
  const railTab = page.locator(".rca-rail-tab, .rca-rail-head");
  if ((await page.locator(".rca-rail-tab").count()) > 0) {
    await page.locator(".rca-rail-tab").click();
    await page.waitForTimeout(500);
  }
  let railText = (await page.locator(".rca-rail").innerText()).toLowerCase();
  if (!railText.includes("business feed"))
    throw new Error(`rail did not open: ${railText.slice(0, 300)}`);
  if (railText.includes("business feed ·"))
    throw new Error("rail should be unscoped before picking a team lead");

  // Pick a team lead and confirm the feed re-scopes.
  await page
    .getByLabel("Filter by sales supervisor")
    .selectOption({ label: "Suzi Hansen" });
  await page.waitForTimeout(2000);
  railText = (await page.locator(".rca-rail").innerText()).toLowerCase();
  if (!railText.includes("business feed · suzi hansen"))
    throw new Error(`rail did not scope: ${railText.slice(0, 300)}`);
  if (!railText.includes("target list"))
    throw new Error("target-list card missing from scoped feed");
  await helper.screenshot("feed-teamlead-scoped.png");

  // Open the target-list card and confirm it drills into a clinic list.
  await page
    .locator(".rca-feed", { hasText: "Which clinics should the target list lead with?" })
    .first()
    .click();
  await page.waitForTimeout(1500);
  const drillText = await page.locator(".rca-drill").innerText();
  if (!drillText.toLowerCase().includes("target list") && drillText.length < 20)
    throw new Error(`drill did not open from feed card: ${drillText.slice(0, 300)}`);
  await helper.screenshot("feed-teamlead-target-drill.png");

  console.log("OK: business feed scopes to team lead and target-list card drills through");
});
