import { test, expect } from "@playwright/test";

test("carte jouée : posée au centre aussitôt, sans trou dans la main ni nouvelle animation des cartes déjà posées", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 414, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  await page.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await page.goto("/");
  await page.evaluate(() => { const b = document.createElement("button"); b.dataset.action = "practice"; document.body.append(b); b.click(); b.remove(); }); // entraînement (retiré de l'accueil)
  await page.locator('[data-action="confirmPractice"]').click();
  // Enchères : on passe jusqu'à la phase de jeu (les robots prennent).
  for (let i = 0; i < 60; i++) {
    if (await page.locator(".hand.my-turn").count()) break;
    const pass = page.locator('.bid-panel [data-action="pass"], [data-action="pass"]').first();
    if (await pass.isVisible().catch(() => false)) await pass.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await expect(page.locator(".hand.my-turn")).toBeVisible({ timeout: 30000 });
  // Une seule carte possible : elle part toute seule (carte automatique) ; on attend alors le tour suivant.
  await page.waitForTimeout(900);
  await expect(page.locator(".hand.my-turn")).toBeVisible({ timeout: 30000 });
  const before = await page.locator(".trick .tcard").count();
  const handBefore = await page.locator(".hand .hcard").count();
  // Essaie chaque carte : seule une carte autorisée part (les autres restent en main).
  let after = before,
    handAfter = handBefore;
  for (let i = 0; i < handBefore && after === before; i++) {
    await page.locator(".hand .hcard").nth(i).dispatchEvent("pointerdown");
    await page.waitForTimeout(60);
    after = await page.locator(".trick .tcard").count();
    handAfter = await page.locator(".hand .hcard").count();
  }
  expect(after).toBe(before + 1);
  expect(handAfter).toBe(handBefore - 1);
  // Un rafraîchissement suivant ne rejoue pas l'animation des cartes déjà posées.
  await page.waitForTimeout(700);
  const seen = await page.locator(".trick .tcard.seen").count();
  const total = await page.locator(".trick .tcard").count();
  expect(seen).toBeGreaterThanOrEqual(Math.max(0, total - 1));
});
