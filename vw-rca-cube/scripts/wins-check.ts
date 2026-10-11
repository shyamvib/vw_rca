import { runTest } from "./auth";

runTest("Wins panel", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(2000);
  await page.setViewportSize({ width: 1500, height: 1400 });
  const emailInput = page.locator(".rca-gate-email, input[type=email]");
  if (await emailInput.count()) {
    await emailInput.fill("shyam@vibrant-wellness.com");
  }
  await page.locator("input[type=password].rca-gate-input").fill("vw-rca-2026");
  await page.locator(".rca-gate-btn").click();
  await page.waitForTimeout(6000);
  if (!(await page.locator(".rca-topbar").count()))
    throw new Error("dashboard did not unlock");

  const wins = page.locator(".rca-wins-grid");
  await wins.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  if (!(await wins.count())) throw new Error("wins panel not rendered");
  await helper.screenshot("wins-panel.png");
  const text = await wins.innerText();
  console.log(text.slice(0, 2000));
});
