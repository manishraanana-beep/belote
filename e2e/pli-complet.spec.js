import { test, expect } from "@playwright/test";
test("pli complet visible avant ramassage", async ({ browser }) => {
  test.setTimeout(170000);
  const page = await (await browser.newContext({ viewport: { width: 414, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  await page.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await page.goto("/");
  await page.locator(".features [data-action='practice']").click();
  await page.locator('[data-action="confirmPractice"]').click();
  let four = false;
  for (let i = 0; i < 600 && !four; i++) {
    if ((await page.locator(".trick:not(.collecting) .tcard").count()) === 4) { four = true; break; }
    if (await page.locator(".hand.my-turn").count()) for (let k = 0; k < 8; k++) { await page.locator(".hand .hcard").nth(k).dispatchEvent("pointerdown").catch(() => {}); await page.locator(".hand .hcard").nth(k).dispatchEvent("pointerup").catch(() => {}); if (!(await page.locator(".hand.my-turn").count())) break; }
    const pass = page.locator('[data-action="pass"]').first();
    if (await pass.isVisible().catch(() => false)) await pass.click().catch(() => {});
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: "test-results/screens/pli-complet.png" });
  expect(four).toBe(true);
});
