import { test, expect } from "@playwright/test";

const shots = "test-results/screens/";
test("bonus de connexion : animation, solde synchronisé sur deux appareils, un seul bonus", async ({ browser }) => {
  const email = `bonus${Date.now()}@exemple.fr`;
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await phone.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await phone.goto("/");
  expect(await phone.evaluate(async (email) => (await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) })).ok, email)).toBe(true);
  await expect(phone.locator(".bonus-pop")).toContainText("Bonus de connexion : +200 crédits !");
  await expect(phone.locator(".bonus-pop")).toContainText("Nouveau solde : 800 crédits");
  await phone.screenshot({ path: `${shots}bonus-connexion.png` });
  await expect(phone.locator(".bonus-line b")).toHaveText(/23 h 5\d min/);
  // Même compte sur ordinateur : même portefeuille, pas de second bonus.
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await desk.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await desk.goto("/");
  expect(await desk.evaluate(async (email) => (await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) })).ok, email)).toBe(true);
  await desk.reload();
  await expect(desk.locator(".wallet-chip")).toContainText("800");
  await desk.waitForTimeout(800);
  await expect(desk.locator(".bonus-pop")).toHaveCount(0);
  // Retour dans l'application (onglet de nouveau visible) : rien de plus avant 24 h.
  await phone.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await phone.waitForTimeout(500);
  await expect(phone.locator(".wallet-chip")).toContainText("800");
});

test("administration : réglage du bonus, création d’un tournoi au calendrier", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await page.goto("/");
  await page.locator('.round-btn[data-page="settings"]').click();
  await page.locator('[data-action="admin"]').click();
  await page.locator('#admin-form [name="key"]').fill("cle-e2e");
  await page.locator("#admin-form .pill").click();
  await page.locator('#bonus-form [name="amount"]').fill("250");
  await page.locator("#bonus-form .pill").click();
  await expect(page.locator('#bonus-form [name="amount"]')).toHaveValue("250");
  await page.locator('[data-action="tourNew"]').click();
  await page.locator('#tour-form [name="name"]').fill("Tournoi de la Saint-Nicolas");
  await page.locator('#tour-form button[value="1"]').click();
  await expect(page.locator("#admin-tours")).toContainText("Tournoi de la Saint-Nicolas");
  await expect(page.locator("#admin-tours")).toContainText("Publié");
  await page.screenshot({ path: `${shots}admin-tournois.png`, fullPage: true });
  await page.locator('#admin-tours .admin-card:has-text("Saint-Nicolas") [data-action="tourPostpone"]').click();
  await page.locator("#tour-postpone-form button.pill").click(); // même date : refusé
  await expect(page.locator("#toast")).toContainText("plus tardive");
  await page.locator('[data-action="tourAdminBack"]').click();
  await page.locator('#admin-tours .admin-card:has-text("Saint-Nicolas") [data-action="tourDuplicate"]').click();
  await expect(page.locator("#admin-tours")).toContainText("Saint-Nicolas (copie)");
  await page.locator('#admin-tours .admin-card:has-text("Saint-Nicolas (copie)") [data-action="tourDetails"]').click();
  await expect(page.locator("#admin-tours")).toContainText("duplication");
  // Remise du bonus par défaut pour les autres tests.
  await page.evaluate(() => fetch("/api/admin", { method: "POST", headers: { Authorization: "Bearer cle-e2e", "Content-Type": "application/json" }, body: JSON.stringify({ type: "loginBonus", amount: 200 }) }));
});

test("connexion avec une adresse inconnue : création du compte proposée", async ({ page }) => {
  await page.goto("/");
  await page.locator('.page-welcome [data-page="login"]').click();
  await page.locator('#login-form [name="email"]').fill(`nouveau${Date.now()}@exemple.fr`);
  await page.locator('#login-form [name="password"]').fill("motdepasse");
  await page.locator("#login-form button.gold-btn").click();
  await expect(page.locator("#modal")).toContainText("Aucun compte n’existe");
  await page.locator('[data-action="createFromLogin"]').click();
  await expect(page.locator(".page-title")).toHaveText("Choisir mon avatar");
});

test("back office : recherche d’un client, crédit manuel et modification de la fiche", async ({ page }) => {
  const email = `client${Date.now()}@exemple.fr`;
  await page.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await page.goto("/");
  expect(await page.evaluate(async (email) => (await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) })).ok, email)).toBe(true);
  await page.reload();
  await page.locator('.round-btn[data-page="settings"]').click();
  await page.locator('[data-action="admin"]').click();
  await page.locator('#admin-form [name="key"]').fill("cle-e2e");
  await page.locator("#admin-form .pill").click();
  await page.locator("#client-search").fill(email);
  await expect(page.locator(".client-row:not([hidden])")).toHaveCount(1);
  await page.locator('.client-row:not([hidden]) [data-action="clientOpen"]').click();
  await page.locator('#client-credit-form [name="amount"]').fill("1500");
  await page.locator('#client-credit-form [name="reason"]').fill("Geste commercial");
  await page.locator("#client-credit-form .pill").click();
  await expect(page.locator(".client-ledger")).toContainText("Geste commercial");
  await page.locator('#client-edit-form [name="name"]').fill("Client VIP");
  await page.locator("#client-edit-form .pill").click();
  await expect(page.locator(".client-head")).toContainText("Client VIP");
  await page.screenshot({ path: "test-results/screens/back-office-client.png" });
});
