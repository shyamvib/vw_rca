import { runTest } from "./auth";

/**
 * Verifies RCA-computed clinic-health flags render as simple badges in the
 * dashboard's clinic search — the exact titles from convex/flags.ts, no new
 * filter UI, no threshold explanation text next to the chip.
 *
 * `runTest` re-throws on failure, but that's a rejected promise at module
 * top level — Bun doesn't reliably turn that into a non-zero process exit
 * on its own, so explicitly force one (matches scripts/rca-test.ts).
 */
runTest("RCA clinic health flags", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(1500);
  if (await page.locator(".rca-gate-input").count()) {
    await page
      .locator('input[type="email"].rca-gate-input')
      .fill("qa@vibrant-wellness.com");
    await page
      .locator('input[type="password"].rca-gate-input')
      .fill("vw-rca-2026");
    await page.locator(".rca-gate-btn").click();
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(4000);

  // "Epigenetics" resolves to a clinic verified server-side (via
  // clinics:clinicDrillInternal) to carry Bundle Defector / AOV Bleed /
  // Revenue Bleed for the full window — search for it and confirm the same
  // exact titles show up as chips in the UI, unembellished.
  await page.locator(".rca-search-input").first().fill("Epigenetics");
  await page.waitForTimeout(1200);
  await helper.screenshot("rca-health-search.png");

  const hitText = await page.locator(".rca-search-hit").first().innerText();
  console.log("search hit text:", hitText.replace(/\n/g, " | "));

  const expectedTitles = [
    "Bundle Defector",
    "AOV Bleed (>25% Drop)",
    "Revenue Bleed (>25% Drop)",
  ];
  for (const title of expectedTitles) {
    if (!hitText.includes(title)) {
      throw new Error(
        `expected health chip "${title}" not found in: ${hitText}`,
      );
    }
  }

  // Guard against the explicitly-rejected UI additions: no threshold/percent
  // rule text, no new filter controls next to the chip itself.
  const chipTexts = await page
    .locator(".rca-search-hit .rca-chip")
    .allInnerTexts();
  for (const chip of chipTexts) {
    if (/threshold|expected .* actual|\bdown \d+%/i.test(chip)) {
      throw new Error(`chip text looks like an added explanation: "${chip}"`);
    }
  }

  // Buying Overdue is computed natively in RCA (business-day rhythm). Verify
  // it travels through the same shared clinic-list/search path as other flags.
  // High Ticket Volume was removed and must never render.
  await page.locator(".rca-search-input").first().fill("Next Health Aventura");
  await page.waitForTimeout(1000);
  const importedHit = await page.locator(".rca-search-hit").first().innerText();
  if (!importedHit.includes("Buying Overdue")) {
    throw new Error(
      `expected Buying Overdue chip in search hit, got: ${importedHit}`,
    );
  }

  if (importedHit.includes("High Ticket Volume")) {
    throw new Error("High Ticket Volume must not render anymore");
  }
  console.log("health chips rendered:", chipTexts, importedHit);
}).catch(() => process.exit(1));
