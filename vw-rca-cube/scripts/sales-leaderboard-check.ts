import { runTest } from "./auth";

runTest("Sales leaderboard filters the page", async helper => {
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

  const board = page.locator(".rca-leaderboard");
  await board.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  if (!(await board.count())) throw new Error("leaderboard did not render");
  const rowCount = await board.locator(".rca-leaderboard-row").count();
  if (rowCount === 0) throw new Error("leaderboard has no rep rows");

  const firstRow = board.locator(".rca-leaderboard-row").first();
  const repName = (await firstRow.locator(".rca-leaderboard-name").innerText()).trim();
  await firstRow.click();
  await page.waitForTimeout(2500);

  const clearBtn = board.locator("button", { hasText: "clear ·" });
  if (!(await clearBtn.count()))
    throw new Error("no clear chip after picking a rep");
  const clearText = await clearBtn.innerText();
  if (!clearText.toLowerCase().includes(repName.toLowerCase()))
    throw new Error(`clear chip does not reflect picked rep: ${clearText}`);

  // Year projection should now say "this book's pro-rata share" since a
  // rep/team-lead scope is active.
  const projText = await page.locator(".rca-proj-title").innerText();
  if (!projText.includes("pro-rata"))
    throw new Error(`projection did not re-scope: ${projText}`);

  await helper.screenshot("sales-leaderboard.png");
  console.log(`rows=${rowCount} picked=${repName} projTitle="${projText}"`);
});
