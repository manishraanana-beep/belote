import { test, expect } from "@playwright/test";

const shots = "test-results/screens/";
const admin = (page, body) =>
  page.evaluate(async (body) => (await fetch("/api/admin", { method: "POST", headers: { Authorization: "Bearer cle-e2e", "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, body);

test("boutique : catégories, aperçu, achat, solde insuffisant, équipement et table personnalisée", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 470, height: 836 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await page.goto("/");
  const email = `shop${Date.now()}@exemple.fr`;
  expect(await page.evaluate(async (email) => (await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) })).ok, email)).toBe(true);
  await page.reload();
  const id = await page.evaluate(async () => (await (await fetch("/api/session", { method: "POST" })).json()).id);
  expect(await admin(page, { type: "playerCredit", id, amount: 12000, reason: "Test boutique" })).toBe(200);
  await page.locator('.tabbar [data-page="boutique"]').click();
  await expect(page.locator(".shop-card")).toHaveCount(6);
  await expect(page.locator(".shop-balance")).toContainText("12 800 jetons");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}boutique.png` });
  // Catégorie « Couleur de table » puis aperçu et achat.
  await page.locator('[data-cat="felt"]').click();
  await expect(page.locator(".shop-card.item")).toHaveCount(5);
  await page.locator('[data-action="shopItem"][data-id="tapis-violet"]').click();
  await expect(page.locator(".shop-modal")).toContainText("3 000 jetons");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}boutique-apercu.png` });
  await page.locator('[data-action="shopBuyAsk"]').click();
  await expect(page.locator(".buy-lines")).toContainText("9 800 jetons");
  // Double appui : un seul débit.
  await page.locator('[data-action="shopBuy"]').dblclick();
  await expect(page.locator(".shop-modal [data-action='shopUse']")).toBeVisible();
  await page.locator(".shop-modal [data-action='shopUse']").click();
  await expect(page.locator(".shop-modal")).toContainText("Équipé");
  await page.keyboard.press("Escape");
  await expect(page.locator(".shop-balance")).toContainText("9 800 jetons");
  // Avatars couronnés : un premier achat, puis solde insuffisant pour le second.
  await page.locator('[data-f="avatars"]').click();
  await page.screenshot({ path: `${shots}boutique-avatars.png`, fullPage: true });
  await page.locator('[data-action="shopItem"][data-id="av-roi-2"]').click();
  await page.locator('[data-action="shopBuyAsk"]').click();
  await page.locator('[data-action="shopBuy"]').click();
  await page.locator(".shop-modal [data-action='shopUse']").click();
  await expect(page.locator(".shop-modal")).toContainText("Équipé");
  await page.keyboard.press("Escape");
  await page.locator('[data-action="shopItem"][data-id="av-roi-3"]').click();
  await page.locator('[data-action="shopBuyAsk"]').click();
  await expect(page.locator(".confirm")).toContainText("Il vous manque 200 jetons");
  await expect(page.locator('.confirm [data-action="shop"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('[data-f="owned"]').click();
  await expect(page.locator(".shop-card.item")).toHaveCount(2);
  // Même compte sur un autre appareil : achats synchronisés.
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await desk.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await desk.goto("/");
  await desk.evaluate(async (email) => fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) }), email);
  await desk.reload();
  await desk.locator('.tabbar [data-page="boutique"]').click();
  await desk.locator('[data-f="owned"]').click();
  await expect(desk.locator(".shop-card.item")).toHaveCount(2);
  await desk.screenshot({ path: `${shots}boutique-ordinateur.png` });
  // Table personnalisée : entraînement avec le tapis violet.
  await page.locator('.tabbar [data-page="home"]').click();
  await page.locator(".features [data-action='practice']").click();
  await page.locator('[data-action="confirmPractice"]').click();
  await expect(page.locator(".screen.game.tapis-violet")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}table-personnalisee.png` });
});
