import { test, expect } from "@playwright/test";

const shots = "test-results/screens/";
const admin = (page, body) =>
  page.evaluate(async (body) => (await fetch("/api/admin", { method: "POST", headers: { Authorization: "Bearer cle-e2e", "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, body);

test("boutique : catégories, aperçu, achat, solde insuffisant, équipement et table personnalisée", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await page.goto("/");
  const email = `shop${Date.now()}@exemple.fr`;
  expect(await page.evaluate(async (email) => (await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) })).ok, email)).toBe(true);
  await page.reload();
  const id = await page.evaluate(async () => (await (await fetch("/api/session", { method: "POST" })).json()).id);
  expect(await admin(page, { type: "playerCredit", id, amount: 12000, reason: "Test boutique" })).toBe(200);
  await page.locator('.tabbar [data-page="boutique"]').click();
  // Accueil de la boutique : 5 collections par ville + 9 autres objets.
  await expect(page.locator(".shop-card")).toHaveCount(14);
  await expect(page.locator(".shop-card.ville-card")).toHaveCount(5);
  await expect(page.locator(".shop-chip")).toHaveText(["Tout", "Classique", "Rare", "Prestige", "Possédés"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".shop-balance")).toContainText("12 600 jetons");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}boutique.png` });
  // Collection Cannes : aperçu puis achat du tapis.
  await page.locator('[data-action="shopCat"][data-cat="cannes"]').click();
  await expect(page.locator(".shop-card.item")).toHaveCount(3);
  await page.locator('[data-action="shopItem"][data-id="felt-cannes"]').click();
  await expect(page.locator(".shop-modal")).toContainText("4 000 jetons");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}boutique-apercu.png` });
  await page.locator('[data-action="shopBuyAsk"]').click();
  await expect(page.locator(".buy-lines")).toContainText("8 600 jetons");
  // Double appui : un seul débit ; objet équipable acheté = équipé aussitôt.
  await page.locator('[data-action="shopBuy"]').dblclick();
  await expect(page.locator(".shop-modal")).toContainText("Équipé");
  await page.keyboard.press("Escape");
  await expect(page.locator(".shop-balance")).toContainText("8 600 jetons");
  // Solde insuffisant : cadre Prestige à 50 000 jetons.
  await page.locator('[data-action="shopFilter"][data-f="Prestige"]').first().click();
  await page.locator('[data-action="shopItem"][data-id="frame-etoile"]').click();
  await page.locator('[data-action="shopBuyAsk"]').click();
  await expect(page.locator(".confirm")).toContainText("Il vous manque 41 400 jetons");
  await expect(page.locator('.confirm [data-action="challenges"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('[data-f="owned"]').click();
  await expect(page.locator(".shop-card.item")).toHaveCount(1);
  await expect(page.locator('.shop-card.item [data-id="felt-cannes"]')).toBeVisible();
  // Même compte sur un autre appareil : achats synchronisés.
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await desk.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await desk.goto("/");
  await desk.evaluate(async (email) => fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) }), email);
  await desk.reload();
  await desk.locator('.tabbar [data-page="boutique"]').click();
  await desk.locator('[data-f="owned"]').click();
  await expect(desk.locator(".shop-card.item")).toHaveCount(1);
  await desk.screenshot({ path: `${shots}boutique-ordinateur.png` });
  // Table personnalisée : entraînement avec le tapis de Cannes.
  await page.locator('.tabbar [data-page="home"]').click();
  await page.screenshot({ path: `${shots}accueil.png` });
  await page.evaluate(() => { const b = document.createElement("button"); b.dataset.action = "practice"; document.body.append(b); b.click(); b.remove(); }); // entraînement (retiré de l'accueil)
  await page.locator('[data-action="confirmPractice"]').click();
  await expect(page.locator(".screen.game.felt-cannes")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}table-personnalisee.png` });
});
