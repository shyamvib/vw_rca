import { runTest } from "./auth";

runTest("RCA clinic search", async helper => {
  const { page } = helper;
  await helper.goto("/dashboard");
  await page.waitForTimeout(1500);
  // unlock the shared-password gate if it is showing
  if (await page.locator(".rca-gate-input").count()) {
    await page.locator(".rca-gate-input").fill("vw-rca-2026");
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(4000);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.locator(".rca-search-input").fill("afdnp");
  await page.waitForTimeout(2500);
  const card = page.locator(".rca-search-card");
  const text = await card.innerText();
  if (!text.toLowerCase().includes("afdnp"))
    throw new Error(`no match rendered: ${text.slice(0, 400)}`);
  const chips = await page.locator(".rca-search-card .rca-chip").count();
  if (chips < 5) throw new Error(`too few list chips: ${chips}`);
  console.log("chips:", chips, "|", text.replace(/\n/g, " ~ ").slice(0, 700));
  await helper.screenshot("rca-search.png");
  // clicking a chip should open the drill list
  await page.locator(".rca-search-card .rca-chip").first().click();
  await page.waitForTimeout(2500);
  const drill = await page.locator(".rca-drill").first().innerText();
  console.log("drill:", drill.replace(/\n/g, " ~ ").slice(0, 300));
  await helper.screenshot("rca-search-drill.png");
});
