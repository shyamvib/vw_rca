import { runTest } from "./auth";

runTest("RCA substitution drill", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(4000);
  await page.setViewportSize({ width: 1600, height: 1400 });
  const card = page.locator(".rca-feed", { hasText: "Toxin Zoomer" }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForTimeout(9000);
  const txt = await page.locator(".rca-drill").innerText();
  console.log("switch panel:", txt.replace(/\n/g, " | ").slice(0, 900));
  await page.locator(".rca-drill").scrollIntoViewIfNeeded();
  await helper.screenshot("rca-switch.png");
  await page.locator(".rca-tab", { hasText: "Moved over" }).first().click();
  await page.waitForTimeout(800);
  console.log(
    "moved tab:",
    (await page.locator(".rca-drill").innerText())
      .replace(/\n/g, " | ")
      .slice(0, 500),
  );
  await helper.screenshot("rca-switch2.png");
});
