import { runTest } from "./auth";

runTest("RCA provider search + clinic plan", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(1500);
  if (await page.locator(".rca-gate-input").count()) {
    await page.locator(".rca-gate-input").fill("vw-rca-2026");
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await page.setViewportSize({ width: 1600, height: 1300 });
  await page.waitForSelector(".rca-proj", { timeout: 60000 });
  const projText = await page.locator(".rca-proj").innerText();
  if (projText.includes("HAS TO COME FROM")) throw new Error("breakdown still shown");
  await page.locator(".rca-proj").screenshot({ path: "tmp/plan-proj-before.png" });

  // provider search
  await page.getByPlaceholder("Search provider…").fill("davis");
  await page.waitForTimeout(9000);
  const provCard = page.locator(".rca-search-card", { hasText: "PROVIDER SEARCH" }).first();
  const pt = await provCard.innerText();
  if (!/CHRISTOPHER DAVIS/i.test(pt)) throw new Error(`provider search: ${pt.slice(0, 300)}`);
  await provCard.screenshot({ path: "tmp/plan-provider.png" });
  await page.getByPlaceholder("Search provider…").fill("");

  // open a clinic list from the tree and set a target
  await page.locator(".rca-lens-row").first().click();
  await page.waitForSelector(".rca-drill table", { timeout: 30000 });
  await page.waitForTimeout(2500);
  const drill = page.locator(".rca-drill").first();
  await drill.screenshot({ path: "tmp/plan-clinics.png" });
  const inputs = drill.locator(".rca-plan-input");
  const n = await inputs.count();
  if (n < 2) throw new Error("plan inputs missing");
  await inputs.nth(1).fill("40000");
  await inputs.nth(1).blur();
  await page.waitForTimeout(3000);
  const after = await page.locator(".rca-proj").innerText();
  if (!/CLINIC PLANS|clinic plans/i.test(after)) throw new Error(`projection did not pick up plan: ${after.slice(-400)}`);
  console.log(after.split("\n").slice(0, 6).join(" | "));
  console.log(after.slice(after.toLowerCase().indexOf("clinic plans") - 20, after.toLowerCase().indexOf("clinic plans") + 320));
  await page.locator(".rca-proj").screenshot({ path: "tmp/plan-proj-after.png" });
});
