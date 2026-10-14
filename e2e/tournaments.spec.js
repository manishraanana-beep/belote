import { test, expect } from "@playwright/test";

const shots = "test-results/screens/";
test.setTimeout(300000);
async function spy(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("discover", "1");
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === "state") window.__beloteState = msg;
        });
      }
    };
  });
}
const admin = (page, body) =>
  page.evaluate(async (body) => {
    const r = await fetch("/api/admin", { method: "POST", headers: { Authorization: "Bearer cle-e2e", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return [r.status, r.ok ? await r.json() : await r.text()];
  }, body);
// Heure locale « AAAA-MM-JJTHH:MM » en UTC, arrondie à la minute.
const local = (ms) => new Date(ms).toISOString().slice(0, 16);

test("tournoi : liste, fiche, solde insuffisant, inscription, présence, départ automatique, tableau et forfait", async ({ browser }) => {
  const mk = async (viewport, mobile) => {
    const page = await (await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })).newPage();
    await spy(page);
    await page.goto("/");
    const n = Math.random().toString(36).slice(2, 8);
    expect(await page.evaluate(async (email) => (await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) })).ok, `t${n}@exemple.fr`)).toBe(true);
    await page.reload();
    await expect(page.locator(".page-home")).toBeVisible();
    return page;
  };
  const phone = await mk({ width: 390, height: 844 }, true);
  const others = [await mk({ width: 1280, height: 800 }), await mk({ width: 1280, height: 800 }), await mk({ width: 1280, height: 800 })];
  const now = Date.now();
  const minute = Math.ceil(now / 60000) * 60000;
  // Tournoi à 50 000 jetons (solde insuffisant) et tournoi d'essai sans seuil, départ dans ~2 minutes.
  const base = { timeZone: "UTC", teams: 8, minTeams: 2, rules: { target: 500, turnSeconds: 20, flyingCounter: true }, rewards: { winner: ["tournoi-vainqueur", "frame-champion"], finalist: ["tournoi-finaliste"], participant: ["tournoi-participant"] }, publish: true };
  expect((await admin(phone, { type: "tourCreate", data: { ...base, name: "Grand Prix du Club", minBalance: 50000, regOpen: local(now - 3600_000), regClose: local(now + 86400_000), confirmBy: local(now + 86400_000 + 3000_000), start: local(now + 86400_000 + 3600_000) } }))[0]).toBe(200);
  expect((await admin(phone, { type: "tourCreate", data: { ...base, name: "Coupe éclair", minBalance: 0, regOpen: local(now - 3600_000), regClose: local(minute + 60_000), confirmBy: local(minute + 60_000), start: local(minute + 120_000) } }))[0]).toBe(200);

  // Accueil → Tournois (style VIP), liste avec places et état.
  await phone.reload();
  await phone.locator(".feature.f-tour").click();
  await expect(phone.locator('.tour-card:has-text("Coupe éclair")')).toBeVisible();
  await expect(phone.locator('.tour-card:has-text("Grand Prix du Club")')).toBeVisible();
  await phone.screenshot({ path: `${shots}tournois-liste.png` });
  // Fiche : solde minimum affiché, inscription refusée avec solde et manque.
  await phone.locator('.tour-card:has-text("Grand Prix du Club")').click();
  await expect(phone.locator(".access-box")).toContainText("Solde minimum requis : 50 000 jetons. Inscription gratuite, aucun jeton prélevé.");
  await phone.screenshot({ path: `${shots}tournoi-fiche.png`, fullPage: true });
  await phone.locator('[data-action="tourRegister"]').click();
  await expect(phone.locator("#modal")).toContainText("Il manque");
  await expect(phone.locator("#modal [data-action='shop']")).toBeVisible();
  await phone.screenshot({ path: `${shots}tournoi-solde-insuffisant.png` });
  await phone.keyboard.press("Escape");

  // Coupe éclair : quatre inscriptions seules, confirmation de présence.
  for (const p of [phone, ...others]) {
    if (p !== phone) {
      await p.locator(".feature.f-tour").click();
    } else await phone.locator('[data-action="back"]').first().click();
    await p.locator('.tour-card:has-text("Coupe éclair")').click();
    await p.locator('[data-action="tourRegister"]').click();
    await expect(p.locator(".status-box").first()).toContainText("Vous êtes inscrit");
    await p.locator('[data-action="tourConfirm"]').click();
    await expect(p.locator(".status-box")).toContainText(["Vous êtes inscrit", "Présence confirmée"]);
  }
  await expect(phone.locator(".lobby-card")).toBeVisible();
  await phone.screenshot({ path: `${shots}tournoi-salon-attente.png`, fullPage: true });
  // Départ automatique à l'heure programmée : chacun est placé à sa table, sans robot.
  for (const p of [phone, ...others]) await expect(p.locator(".hand .hcard")).toHaveCount(8, { timeout: 200000 });
  await expect(phone.locator(".seat .robot-tag")).toHaveCount(0);
  await expect(phone.locator(".screen.game")).toHaveClass(/theme-vip/);
  const ok = await phone.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1);
  expect(ok, "aucun défilement en partie").toBe(true);
  await phone.screenshot({ path: `${shots}tournoi-table.png` });
  // Abandon d'un adversaire : forfait, le tableau affiche le résultat et les vainqueurs.
  const st = await phone.evaluate(() => window.__beloteState.table);
  const myId = await phone.evaluate(() => window.__beloteState.player.id);
  const mySeat = st.seats.findIndex((s) => s.id === myId);
  const rivalId = st.seats[(mySeat + 1) % 4].id;
  for (const p of others)
    if ((await p.evaluate(() => window.__beloteState.player.id)) === rivalId) {
      await p.locator('[data-action="menu"]').click();
  await p.locator('.sheet [data-action="quitGame"]').click();
      await expect(p.locator("#modal")).toContainText("forfait");
      await p.locator('[data-action="confirmLeave"]').click();
    }
  await expect(phone.locator(".champion")).toBeVisible({ timeout: 15000 });
  await expect(phone.locator(".match-card.forfeit")).toContainText("Abandon");
  await phone.screenshot({ path: `${shots}tournoi-tableau.png`, fullPage: true });
  await phone.locator(".page-top [data-action='back']").click();
  await phone.locator('[data-action="inbox"]').click();
  await expect(phone.locator(".inbox")).toContainText("Votre table est prête, rejoignez la partie !");
  await phone.screenshot({ path: `${shots}tournoi-notifications.png` });
});
