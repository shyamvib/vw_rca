import { runTest } from "./auth";

runTest("RCA dashboard", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(1500);
  // unlock the shared-password gate if it is showing
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
  const body = await page.locator("body").innerText();
  if (!body.toLowerCase().includes("shortfall tree"))
    throw new Error(`tree missing: ${body.slice(0, 500)}`);
  if (!body.toLowerCase().includes("volume vs price"))
    throw new Error("lens A missing");
  await page.setViewportSize({ width: 1600, height: 1400 });
  await helper.screenshot("rca-full.png");
  // click a week bar and confirm the tree re-cuts
  const before = await page.locator(".rca-root-value").innerText();
  await page.locator(".rca-bar-slot").nth(3).click();
  await page.waitForTimeout(800);
  const after = await page.locator(".rca-root-value").innerText();
  if (before === after)
    throw new Error("clicking a week did not re-cut the tree");
  await helper.screenshot("rca-week.png");
  // daily zoom
  await page.locator(".rca-tab", { hasText: "Daily" }).first().click();
  await page.waitForTimeout(600);
  const allBars = await page.locator(".rca-bar-slot").count();
  await page
    .locator(".rca-zoombar .rca-tab", { hasText: "30d" })
    .first()
    .click();
  await page.waitForTimeout(400);
  const zoomed = await page.locator(".rca-bar-slot").count();
  if (zoomed !== 30 || allBars <= 30) {
    throw new Error(`zoom failed: all=${allBars} zoomed=${zoomed}`);
  }
  await page
    .locator(".rca-zoombar .rca-tab", { hasText: "\u2190" })
    .first()
    .click();
  await page.waitForTimeout(300);
  await helper.screenshot("rca-zoom.png");
  await page.locator(".rca-btn-ghost", { hasText: "Settings" }).first().click();
  await page.waitForTimeout(300);
  await helper.screenshot("rca-settings.png");
  // Settings drawer grew a few more ".rca-controls" sections over time
  // (Access log, Rep logins) alongside the original Baseline one this check
  // targets — scope to .first() so the locator stays unambiguous (found
  // 2026-09-28, unrelated to that day's backend baseline work).
  const controls = await page.locator(".rca-controls").first().innerText();
  await page.locator(".rca-drawer-scrim").click();
  await page.waitForTimeout(300);
  console.log("controls:", controls.replace(/\n/g, " ").slice(0, 220));
  await page.locator(".rca-tab", { hasText: "Weekly" }).first().click();
  await page.waitForTimeout(400);

  // level 2: product families + customer expansion
  const famRows = await page.locator(".rca-fam-row").count();
  if (famRows < 4) throw new Error(`no product family level: ${famRows}`);
  const famName = await page
    .locator(".rca-fam-row .rca-fam-name")
    .nth(0)
    .innerText();
  await page.locator(".rca-fam-row").nth(0).click();
  await page.waitForSelector(".rca-drill-title", { timeout: 120000 });
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("Querying Power BI for this family"),
    undefined,
    { timeout: 180000 },
  );
  const famHead = await page.locator(".rca-drill").innerText();
  console.log("family drill:", famHead.replace(/\n/g, " | ").slice(0, 200));
  if (!famHead.includes(famName.slice(0, 12))) {
    throw new Error("family panel title mismatch");
  }
  if (famName.includes("Unmapped")) {
    await page.waitForFunction(
      () => !document.body.innerText.includes("Querying the test-level table"),
      undefined,
      { timeout: 180000 },
    );
    const unmapped = await page.locator(".rca-unmapped").innerText();
    if (!/order/i.test(unmapped)) {
      throw new Error("unmapped test breakdown missing");
    }
    console.log(
      "unmapped tests:",
      unmapped.replace(/\n/g, " | ").slice(0, 220),
    );
  }
  await page.locator(".rca-drill .rca-expand").first().click();
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading customers"),
    undefined,
    { timeout: 120000 },
  );
  const sub = await page.locator(".rca-subrow").first().innerText();
  console.log("customers:", sub.replace(/\n/g, " | ").slice(0, 180));
  if (!sub.toLowerCase().includes("patients") && !sub.includes("No customer")) {
    throw new Error("customer table missing");
  }
  await helper.screenshot("rca-family.png");

  // drill-down: open the retained top-20% cohort clinic list
  await page
    .locator(".rca-tab", { hasText: "FULL WINDOW" })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(500);
  await page.locator(".rca-lens-row", { hasText: "Retained" }).first().click();
  await page.waitForTimeout(2500);
  const rows = await page.locator(".rca-table tbody tr").count();
  if (rows < 10) throw new Error(`clinic table only had ${rows} rows`);
  const drillText = await page.locator(".rca-drill").innerText();
  console.log("drill:", drillText.split("\n").slice(0, 4).join(" | "));
  await helper.screenshot("rca-drill.png");
  await page.locator(".rca-tab").first().click();
  await page.waitForTimeout(600);
  await helper.screenshot("rca-month.png");
  console.log("root full:", before, "-> week:", after);
}).catch(() => process.exit(1));
