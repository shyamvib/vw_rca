import { runTest } from "./auth";

runTest("RCA projection card", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(1500);
  if (await page.locator(".rca-gate-input").count()) {
    await page.locator(".rca-gate-input").fill("vw-rca-2026");
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await page.setViewportSize({ width: 1500, height: 1500 });
  await page.waitForSelector(".rca-proj", { timeout: 60000 });
  await page.waitForTimeout(3500);
  const text = await page.locator(".rca-proj").innerText();
  if (!text.toLowerCase().includes("year-end projection")) throw new Error("no card");
  console.log(text.slice(0, 700));
  await page.locator(".rca-proj").screenshot({ path: "tmp/rca-proj.png" });
  await page.locator(".rca-tab", { hasText: "Product family" }).click();
  await page.waitForTimeout(600);
  await page.locator(".rca-proj").screenshot({ path: "tmp/rca-proj-family.png" });
});
