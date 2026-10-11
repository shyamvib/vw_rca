import { runTest } from "./auth";

runTest("RCA password gate", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(2500);
  await page.setViewportSize({ width: 1400, height: 900 });
  const gate = page.locator(".rca-gate-card");
  if (!(await gate.count())) throw new Error("gate not shown");
  await helper.screenshot("rca-gate.png");
  // wrong password stays locked
  await page.locator('input[type="email"]').fill("test@vibrant-wellness.com");
  await page.locator('input[type="password"]').fill("nope");
  await page.locator(".rca-gate-btn").click();
  await page.waitForTimeout(1500);
  if (!(await page.locator(".rca-gate-error").count()))
    throw new Error("wrong password did not error");
  if (await page.locator(".rca-topbar").count())
    throw new Error("dashboard leaked with a wrong password");
  // right password unlocks
  await page.locator('input[type="password"]').fill("vw-rca-2026");
  await page.locator(".rca-gate-btn").click();
  await page.waitForTimeout(6000);
  if (!(await page.locator(".rca-topbar").count()))
    throw new Error("dashboard did not unlock");
  console.log("unlocked ok");
  await helper.screenshot("rca-gate-unlocked.png");
});
