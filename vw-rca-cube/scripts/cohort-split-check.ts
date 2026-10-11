import { runTest } from "./auth";

runTest("Cohort positive/negative driver split", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(2000);
  await page.setViewportSize({ width: 1500, height: 1400 });
  const emailInput = page.locator(".rca-gate-email, input[type=email]");
  if (await emailInput.count()) {
    await emailInput.fill("shyam@vibrant-wellness.com");
  }
  await page
    .locator("input[type=password].rca-gate-input")
    .fill("vw-rca-2026");
  await page.locator(".rca-gate-btn").click();
  await page.waitForTimeout(6000);
  if (!(await page.locator(".rca-topbar").count()))
    throw new Error("dashboard did not unlock");

  // Find the "Clinic cohort" lens card and click its first (worst) row.
  const cohortCard = page.locator(".rca-lens", {
    hasText: "Clinic cohort",
  });
  await cohortCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  const firstRow = cohortCard.locator(".rca-lens-row").first();
  await firstRow.click();
  await page.waitForTimeout(3000);

  const split = page.locator(".rca-drill-split");
  await split.scrollIntoViewIfNeeded();
  if (!(await split.count()))
    throw new Error("positive/negative driver split did not render");
  await helper.screenshot("cohort-split.png");
  console.log(await split.innerText());
});
