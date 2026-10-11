import { runTest } from "./auth";

runTest("Wins card opens full clinic drill list", async helper => {
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

  const momentumCard = page.locator(".rca-win-card-btn", {
    hasText: "Momentum",
  });
  await momentumCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await momentumCard.click();
  await page.waitForTimeout(3000);

  const drill = page.locator(".rca-drill");
  if (!(await drill.count())) throw new Error("drill panel did not open");
  const title = await drill.locator(".rca-drill-title").innerText();
  if (!title.includes("Momentum"))
    throw new Error(`drill title did not reflect card: ${title}`);
  const rows = drill.locator("table tbody tr");
  const rowCount = await rows.count();
  if (rowCount === 0) throw new Error("drill table has no rows");
  const headerCount = await drill.locator("table thead th").count();
  await helper.screenshot("wins-drill.png");
  console.log(`title=${title} rows=${rowCount} columns=${headerCount}`);
});
