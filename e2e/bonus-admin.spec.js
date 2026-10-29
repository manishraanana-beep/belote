import { test, expect } from "@playwright/test";

const shots = "test-results/screens/";
const setBonus = (page, amount) => page.evaluate((amount) => fetch("/api/admin", { method: "POST", headers: { Authorization: "Bearer cle-e2e", "Content-Type": "application/json" }, body: JSON.stringify({ type: "loginBonus", amount }) }), amount);
test("roue du jour : pas de tour le jour de l'inscription, compte à rebours de 24 h", async ({ browser }) => {
  const email = `bonus${Date.now()}@exemple.fr`;
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await phone.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await phone.goto("/");
  await setBonus(phone, 200);
  try {
    expect(await phone.evaluate(async (email) => (await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) })).ok, email)).toBe(true);
    await phone.reload();
    await phone.waitForTimeout(1200);
    // Les crédits de bienvenue suffisent : la roue ne s'ouvre pas, prochain tour dans environ 24 h.
    await expect(phone.locator(".wheel-modal")).toHaveCount(0);
    await phone.evaluate(() => { const b = document.createElement("button"); b.dataset.action = "wheel"; document.body.append(b); b.click(); b.remove(); });
    await expect(phone.locator(".wheel-modal .wheel-next")).toContainText(/2[34] h/);
    await expect(phone.locator('.wheel-modal button[data-action="spin"]')).toHaveCount(0);
  } finally {
    await setBonus(phone, 0);
  }
});

test("administration : réglage du bonus, création d’un tournoi au calendrier", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await page.goto("/");
  await page.goto("/admin");
  await page.locator('#admin-form [name="key"]').fill("cle-e2e");
  await page.locator("#admin-form .pill").click();
  await page.screenshot({ path: "test-results/screens/back-office-accueil.png" });
  await page.locator('[data-tab="settings"]').click();
  await page.locator('#bonus-form [name="amount"]').fill("250");
  await page.locator("#bonus-form .pill").click();
  await expect(page.locator('#bonus-form [name="amount"]')).toHaveValue("250");
  await page.locator('[data-tab="tours"]').click();
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
  await page.evaluate(() => fetch("/api/admin", { method: "POST", headers: { Authorization: "Bearer cle-e2e", "Content-Type": "application/json" }, body: JSON.stringify({ type: "loginBonus", amount: 0 }) }));
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
  await page.goto("/admin");
  await page.locator('#admin-form [name="key"]').fill("cle-e2e");
  await page.locator("#admin-form .pill").click();
  await page.locator('[data-tab="clients"]').click();
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

test("back office : reste connecté après rechargement, déconnexion", async ({ page }) => {
  await page.goto("/admin");
  await page.locator('#admin-form [name="key"]').fill("cle-e2e");
  await page.locator("#admin-form .pill").click();
  await expect(page.locator(".admin-tabs")).toBeVisible();
  await page.reload();
  await expect(page.locator(".admin-tabs")).toBeVisible();
  await expect(page.locator("#admin-form")).toBeHidden();
  await page.locator('[data-action="adminLogout"]').click();
  await expect(page.locator("#admin-form")).toBeVisible();
});

test("back office : modification d’un article de la boutique", async ({ page }) => {
  await page.goto("/admin");
  await page.locator('#admin-form [name="key"]').fill("cle-e2e");
  await page.locator("#admin-form .pill").click();
  await page.locator('[data-tab="boutique"]').click();
  const f = page.locator('.shop-item-form[data-id="emo-02"]');
  await f.locator('[name="price"]').fill("350");
  await f.locator('[name="name"]').fill("Clin d’œil malin");
  await f.locator(".pill").click();
  await expect(page.locator('.shop-item-form[data-id="emo-02"] [name="price"]')).toHaveValue("350");
  await page.screenshot({ path: "test-results/screens/admin-boutique.png" });
});
