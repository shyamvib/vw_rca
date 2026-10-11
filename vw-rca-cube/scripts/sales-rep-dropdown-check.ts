import { runTest } from "./auth";

runTest("Top-level sales rep dropdown scopes the page", async helper => {
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

  const repSelect = page.locator('select[aria-label="Filter by sales rep"]');
  if (!(await repSelect.count())) throw new Error("rep dropdown not found");
  const options = await repSelect.locator("option").allTextContents();
  if (options.length < 2)
    throw new Error(`rep dropdown has no reps: ${JSON.stringify(options)}`);

  const pick = options[1];
  await repSelect.selectOption({ label: pick });
  await page.waitForTimeout(2500);

  // leaderboard's "clear" chip should reflect the same selection
  const clearBtn = page
    .locator(".rca-leaderboard")
    .locator("button", { hasText: "clear ·" });
  if (!(await clearBtn.count()))
    throw new Error("leaderboard did not sync with dropdown selection");
  const clearText = (await clearBtn.innerText()).toLowerCase();
  if (!clearText.includes(pick.toLowerCase()))
    throw new Error(`leaderboard out of sync: ${clearText} vs ${pick}`);

  const projText = await page.locator(".rca-proj-title").innerText();
  if (!projText.includes("pro-rata"))
    throw new Error(`projection did not re-scope from dropdown: ${projText}`);

  // reset to "All reps" and confirm it clears
  await repSelect.selectOption({ label: "All reps" });
  await page.waitForTimeout(2000);
  const projText2 = await page.locator(".rca-proj-title").innerText();
  if (projText2.includes("pro-rata"))
    throw new Error("selecting All reps did not clear the scope");

  await helper.screenshot("sales-rep-dropdown.png");
  console.log(`options=${options.length} picked="${pick}" ok`);
});
