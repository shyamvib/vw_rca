import { runTest } from "./auth";

runTest("Product-family panel re-scopes to a picked sales rep", async helper => {
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

  const famPanel = () => page.locator(".rca-fam").first();
  const baseline = (await famPanel().innerText()).slice(0, 400);

  const repSelect = page.locator('select[aria-label="Filter by sales rep"]');
  const options = await repSelect.locator("option").allTextContents();
  const pick = options[1];
  await repSelect.selectOption({ label: pick });
  await page.waitForTimeout(2500);
  const scoped = (await famPanel().innerText()).slice(0, 400);

  if (scoped === baseline)
    throw new Error(
      `family panel text unchanged after picking a rep\nbefore=${baseline}\nafter=${scoped}`,
    );

  await helper.screenshot("rep-family-scope.png");
  console.log(`picked="${pick}" family panel changed: OK`);
  console.log("before:", baseline.replace(/\n/g, " | "));
  console.log("after:", scoped.replace(/\n/g, " | "));
});
