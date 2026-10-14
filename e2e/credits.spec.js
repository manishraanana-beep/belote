import { test, expect } from "@playwright/test";

const shots = "test-results/screens/";
test.setTimeout(240000);

async function spy(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("discover", "1");
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        window.__ws = this;
        this.addEventListener("message", (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === "state") window.__beloteState = msg;
        });
      }
    };
  });
}
const st = (page) => page.evaluate(() => window.__beloteState);
const send = (page, type, data = {}) =>
  page.evaluate(([type, data]) => window.__ws.send(JSON.stringify({ id: crypto.randomUUID(), type, data })), [type, data]);
async function register(page, email) {
  await page.goto("/");
  await expect(page.locator(".page-home")).toBeVisible();
  const ok = await page.evaluate(async (email) => (await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) })).ok, email);
  expect(ok).toBe(true);
  await page.reload();
  // Cadeau de bienvenue (600 en test) + bonus de connexion immédiat (200).
  await expect(page.locator(".wallet-chip")).toContainText("800");
}
async function noScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("crédits et social : portefeuille, boutique, amis, invitation, mise, engagés, réactions, résultat, revanche", async ({ browser }) => {
  const mk = async (viewport, mobile = false) => {
    const page = await (await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })).newPage();
    await spy(page);
    return page;
  };
  const A = await mk({ width: 1280, height: 800 });
  const B = await mk({ width: 390, height: 844 }, true);
  const C = await mk({ width: 1280, height: 800 });
  const D = await mk({ width: 1280, height: 800 });
  const E = await mk({ width: 390, height: 844 }, true);
  const n = Date.now();
  for (const [i, p] of [A, B, C, D, E].entries()) await register(p, `joueur${i}-${n}@exemple.fr`);
  await send(A, "profile", { name: "Alice" });
  await send(B, "profile", { name: "Bruno" });
  await send(C, "profile", { name: "Chloé" });
  await send(D, "profile", { name: "Driss" });
  await send(E, "profile", { name: "Emma" });

  // Portefeuille, bonus du jour, boutique (paiement de test), historique.
  await A.locator(".wallet-chip").click();
  await expect(A.locator(".wallet-hero")).toContainText("800");
  await expect(A.locator("#modal .daily-done")).toContainText("Bonus de connexion");
  await A.screenshot({ path: `${shots}portefeuille.png` });
  await A.keyboard.press("Escape");
  await A.locator(".quick-row [data-action='shop']").click();
  await expect(A.locator(".pack")).toHaveCount(4);
  await A.screenshot({ path: `${shots}boutique.png` });
  await A.locator('.pack [data-pack="pack-1000"]').click();
  await expect(A.locator(".wallet-chip")).toContainText("1 800");
  await A.locator(".wallet-chip").click();
  await A.locator('#modal [data-action="history"]').click();
  await expect(A.locator(".ledger li")).toHaveCount(3);
  await A.screenshot({ path: `${shots}historique-credits.png` });
  await A.keyboard.press("Escape");

  // Amis : recherche par identifiant, demande, acceptation.
  const bTag = (await st(B)).player.tag;
  await A.locator(".quick-row [data-action='friends']").click();
  await A.locator('#modal [data-tab="search"]').click();
  await A.locator('#search-form [name="q"]').fill(bTag);
  await A.locator("#search-form .pill").click();
  await A.locator('#search-results [data-action="friendRequest"]').click();
  await A.waitForTimeout(400);
  await A.keyboard.press("Escape");
  await expect(B.locator(".quick-row .badge-n").first()).toHaveText("1");
  await B.locator(".quick-row [data-action='friends']").click();
  await B.locator('#modal [data-tab="requests"]').click();
  await B.screenshot({ path: `${shots}amis-demandes.png` });
  await B.locator('#modal [data-action="friendAccept"]').click();
  await B.waitForTimeout(400);
  await B.keyboard.press("Escape");

  // Création d'une table publique à 200 crédits.
  await A.locator('.tabbar [data-page="tables"]').click();
  await A.locator('[data-action="createPublic"]').click();
  await A.locator('#create-form [name="name"]').fill("Table des amis");
  await A.locator('#create-form label:has(input[name="stake"][value="200"])').click();
  await A.locator(".advanced summary").click();
  await A.locator('#create-form [name="target"]').fill("100");
  await A.screenshot({ path: `${shots}choix-mise.png` });
  await A.locator("#create-form .cta").click();
  await expect(A.locator(".page-room .page-title")).toHaveText("Table des amis");

  // Invitation d'un ami : détails, aucun engagement avant acceptation.
  await A.locator('.slot [data-action="friends"]').first().click();
  await expect(A.locator(".friend")).toHaveCount(1);
  await A.screenshot({ path: `${shots}amis-inviter.png` });
  await A.locator('#modal [data-action="inviteFriend"]').click();
  await A.keyboard.press("Escape");
  await expect(B.locator(".invite-card")).toContainText("Table des amis");
  await expect(B.locator(".invite-card")).toContainText("200");
  await B.screenshot({ path: `${shots}invitation-recue.png` });
  await B.locator('.invite-card [data-action="inviteOpen"]').click();
  await expect(B.locator(".stake-warning")).toContainText("En rubicon, vous risquez jusqu’à 600 crédits");
  await B.screenshot({ path: `${shots}avertissement-mise.png` });
  await B.locator('#modal [data-action="inviteAccept"]').click();
  await expect(B.locator(".page-room .page-title")).toHaveText("Table des amis");

  // C et D rejoignent depuis la liste publique, après l'avertissement de mise.
  for (const p of [C, D]) {
    await p.reload();
    await p.locator('.tabbar [data-page="tables"]').click();
    await p.locator('.table-card:has-text("Table des amis") [data-action="join"]').click();
    // Entrée directe, sans fenêtre de règles.
    await expect(p.locator(".page-room .page-title")).toHaveText("Table des amis");
  }
  await expect(A.locator(".slot .engaged")).toHaveCount(4);
  await A.screenshot({ path: `${shots}credits-engages-salon.png` });

  // Solde insuffisant : Emma (600) face à une table à 1 000.
  await E.locator('.feature.f-vip').click();
  await E.locator('[data-page="vipCreate"]').click();
  await E.locator('#create-form [name="name"]').fill("Grosse table");
  await E.locator('#create-form label:has(input[name="stake"][value="1000"])').click();
  await E.locator("#create-form button.gold-btn").click();
  await expect(E.locator("#modal")).toContainText("Solde insuffisant");
  await E.screenshot({ path: `${shots}solde-insuffisant.png` });
  await E.keyboard.press("Escape");

  // Lancement : réservations visibles, aucun défilement.
  await A.locator('[data-action="start"]').click();
  await expect(A.locator(".hand .hcard")).toHaveCount(8);
  await expect(A.locator(".gt-chip.table")).toContainText("200 jetons");
  // Réactions : sélecteur, apparition près de l'avatar de l'auteur chez les autres.
  await B.locator('[data-action="react"]').click();
  await B.screenshot({ path: `${shots}reactions.png` });
  await B.locator('.react-btn[data-id="merci"]').click();
  await expect(A.locator(".reaction-pop")).toContainText("Merci partenaire !");
  await A.screenshot({ path: `${shots}reaction-table.png` });
  await noScroll(B);
  // Profil d'un joueur : masquer, bloquer, signaler.
  await A.locator('.seat [data-action="player"]').first().click();
  await expect(A.locator(".sheet")).toContainText("Bloquer");
  await A.screenshot({ path: `${shots}joueur-options.png` });
  await A.locator('.sheet [data-action="reportPlayer"]').click();
  await A.locator('#report-player-form label:has(input[value="spam"])').click();
  await A.screenshot({ path: `${shots}signalement.png` });
  await A.locator("#report-player-form .cta").click();

  // La partie se joue jusqu'au bout (chaque joueur joue depuis sa propre connexion).
  const pages = [A, B, C, D];
  for (let guard = 0; guard < 1500; guard++) {
    const s = await st(A);
    const g = s.table.game;
    if (g.phase === "finished") break;
    if (g.phase === "summary") await send(A, "next");
    else if (g.phase === "bidding" || g.phase === "playing") {
      const who = s.table.seats[g.turn].id;
      for (const p of pages) {
        const ps = await st(p);
        if (ps.player.id !== who || ps.table.game.version !== g.version) continue;
        const pg = ps.table.game;
        const action = pg.phase === "bidding" ? (pg.contract ? { type: "pass" } : { type: "bid", amount: 80, suit: "H" }) : pg.legal.length ? { type: "play", card: pg.legal[0] } : null;
        if (action) await send(p, "action", { version: pg.version, action });
      }
    }
    await A.waitForTimeout(40);
  }
  await expect(A.locator(".overlay-page.final .money")).toBeVisible({ timeout: 20000 });
  await expect(A.locator(".overlay-page.final .money")).toContainText(/Bénéfice|Perte/);
  await expect(A.locator(".overlay-page.final .money")).toContainText("Nouveau solde");
  await A.screenshot({ path: `${shots}resultat-credits.png` });
  await B.screenshot({ path: `${shots}resultat-credits-telephone.png` });
  // Revanche : chacun confirme, lancement automatique quand les quatre ont accepté.
  await A.locator('[data-action="rematchYes"]').click();
  await expect(A.locator(".vote.ok")).toHaveCount(1);
  await A.screenshot({ path: `${shots}revanche-confirmation.png` });
  // Un joueur à court de crédits ne peut pas confirmer : on lui propose la boutique ou une table moins chère.
  const rubicon = (await st(A)).table.result.rubicon;
  for (const p of [B, C, D]) {
    const me = await st(p);
    if (me.player.wallet.available < 400) {
      await p.locator('[data-action="rematchYes"]').click();
      await expect(p.locator("#modal")).toContainText("Solde insuffisant");
      await p.screenshot({ path: `${shots}revanche-solde-insuffisant.png` });
      await p.locator('#modal .menu-item[data-action="shop"]').click();
      await p.locator('.pack [data-pack="pack-1000"]').click();
      await expect.poll(async () => (await st(p)).player.wallet.available).toBeGreaterThanOrEqual(400);
    }
    await p.locator('[data-action="rematchYes"]').click();
  }
  await expect(A.locator(".hand .hcard")).toHaveCount(8);
  expect((await st(A)).table.money.settled).toBe(false);
  void rubicon;

  // Défis, niveau et badges, collection.
  await A.locator('[data-action="menu"]').click();
  await A.locator('.sheet [data-action="quitGame"]').click();
  await expect(A.locator("#modal")).toContainText("Un robot prendra votre place");
  await A.locator('[data-action="confirmLeave"]').click();
  await A.locator('.tabbar [data-page="home"]').click();
  await A.locator(".quick-row [data-action='challenges']").click();
  await expect(A.locator(".challenges li")).toHaveCount(3);
  await A.screenshot({ path: `${shots}defis.png` });
  await A.keyboard.press("Escape");
  await A.locator('.tabbar [data-page="profile"]').click();
  await A.locator(".menu-card [data-action='progress']").click();
  await expect(A.locator(".badge.on").first()).toBeVisible();
  await A.screenshot({ path: `${shots}niveau-badges.png` });
  await A.keyboard.press("Escape");
  await A.locator(".menu-card [data-action='collection']").click();
  await A.locator('#modal [data-kind="felt"]').first().click();
  await A.screenshot({ path: `${shots}collection.png` });
  await A.keyboard.press("Escape");

  // Administration : signalements avec contexte de partie.
  await A.goto("/admin");
  await A.locator('#admin-form [name="key"]').fill("cle-e2e");
  await A.locator("#admin-form .pill").click();
  await A.locator('[data-tab="moderation"]').click();
  await expect(A.locator("#admin-result")).toContainText("Spam");
  await A.screenshot({ path: `${shots}moderation.png`, fullPage: true });
});
