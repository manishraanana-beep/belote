import { test, expect } from "@playwright/test";

const shots = "test-results/screens/";
// Expose le dernier état reçu pour choisir une carte autorisée (le test joue comme un humain).
async function spy(page) {
  await page.addInitScript(() => {
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
const game = (page) => page.evaluate(() => window.__beloteState?.table?.game);
async function noScroll(page) {
  const r = await page.evaluate(() => ({
    h: document.documentElement.scrollHeight <= innerHeight + 1,
    w: document.documentElement.scrollWidth <= innerWidth + 1,
  }));
  expect(r, "aucun défilement pendant la partie").toEqual({ h: true, w: true });
}
async function inView(page, selector) {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= -1 && r.left >= -1 && r.right <= innerWidth + 1 && r.top < innerHeight - 8;
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  expect(boxes.every(Boolean), `${selector} visible à l’écran`).toBe(true);
}
// Touche la partie visible d'une carte (à gauche, à mi-hauteur), comme le ferait un doigt.
async function tap(el) {
  const b = await el.boundingBox();
  await el.click({ position: { x: Math.max(4, b.width * 0.12), y: b.height * 0.42 } });
}
async function playLegal(page) {
  const g = await game(page);
  const el = page.locator(`.hand [data-card="${g.legal[0]}"]`);
  await tap(el);
  await expect(el).toHaveClass(/selected/);
  await tap(el);
}
async function startPractice(page) {
  await page.goto("/");
  await page.locator('.tiles [data-action="practice"]').click();
  await page.locator('[data-action="confirmPractice"]').click();
  await expect(page.locator(".hand .hcard")).toHaveCount(8);
}

for (const [name, viewport, mobile] of [
  ["ordinateur", { width: 1366, height: 768 }, false],
  ["telephone", { width: 390, height: 844 }, true],
  ["petit-telephone", { width: 320, height: 568 }, true],
  ["paysage", { width: 844, height: 390 }, true],
  ["tablette", { width: 768, height: 1024 }, true],
])
  test(`table ${name} : main, enchères, preneur, pli, dernier pli, scores, sans défilement`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await spy(page);
    await startPractice(page);
    // Main complète de huit cartes, triée pique, cœur, trèfle, carreau.
    await expect.poll(() => page.$$eval(".hand img", (i) => i.filter((x) => x.complete && x.naturalWidth).length)).toBe(8);
    const order = await page.$$eval(".hand .hcard", (b) => b.map((x) => x.dataset.card.slice(-1)));
    expect(order.join("")).toBe([...order].sort((a, b) => "SHCD".indexOf(a) - "SHCD".indexOf(b)).join(""));
    await expect(page.locator(".hand")).toHaveClass(/glow/);
    await page.waitForTimeout(700);
    await noScroll(page);
    await inView(page, ".hand .hcard");
    await inView(page, ".seat .seat-avatar");
    await inView(page, ".scoreboard");
    // Choix d'enchères compact, entièrement visible.
    await inView(page, ".bid-panel .amount, .bid-panel .suit-btn, .bid-panel .pass-btn");
    await page.screenshot({ path: `${shots}${name}-1-encheres.png` });
    await page.locator('.amount[data-amount="90"]').click();
    await page.locator('.suit-btn[value="S"]').click();
    // Annonce du preneur au centre, avec son équipe ; badge permanent en haut.
    const banner = page.locator(".contract-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText("a pris");
    await expect(banner).toContainText(/Votre équipe|Équipe adverse/);
    await expect(page.locator(".contract-badge")).not.toHaveClass(/pending/);
    await page.screenshot({ path: `${shots}${name}-2-preneur.png` });
    await noScroll(page);
    // Une carte sélectionnée ressort avant d'être jouée.
    await expect.poll(async () => (await game(page)).phase, { timeout: 15000 }).toBe("playing");
    await expect.poll(async () => (await game(page)).legal.length, { timeout: 15000 }).toBeGreaterThan(0);
    const first = (await game(page)).legal[0];
    await tap(page.locator(`.hand [data-card="${first}"]`));
    await expect(page.locator(".hand .selected")).toHaveCount(1);
    await page.screenshot({ path: `${shots}${name}-3-selection.png` });
    await tap(page.locator(`.hand [data-card="${first}"]`));
    // L'annonce laisse la place aux cartes jouées.
    await expect(page.locator(".trick .tcard").first()).toBeVisible();
    await expect(banner).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}${name}-4-pli.png` });
    // Dernier pli : rappel du contrat, fermeture d'une touche.
    await expect(page.locator('[data-action="lastTrick"]')).toBeEnabled({ timeout: 15000 });
    await page.waitForTimeout(1300);
    await page.locator('[data-action="lastTrick"]').click();
    await expect(page.locator(".sheet-lastTrick .lt-cards img")).toHaveCount(4);
    await expect(page.locator(".lt-contract")).toContainText(/Votre équipe|Équipe adverse/);
    await page.screenshot({ path: `${shots}${name}-5-dernier-pli.png` });
    await page.mouse.click(8, Math.round(viewport.height / 2));
    await expect(page.locator(".sheet")).toHaveCount(0);
    await noScroll(page);
    await inView(page, ".scoreboard .score b");
    expect(errors).toEqual([]);
    await ctx.close();
  });

test("changement d’orientation pendant la partie", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await startPractice(page);
  for (const v of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(v);
    await page.waitForTimeout(300);
    await noScroll(page);
    await inView(page, ".hand .hcard");
    await inView(page, ".bid-panel .suit-btn");
  }
  await page.screenshot({ path: `${shots}rotation-paysage.png` });
  await ctx.close();
});

test("partie complète contre les robots, scores et revanche", async ({ page }) => {
  test.setTimeout(150000);
  await spy(page);
  await page.goto("/");
  await page.locator('.tiles [data-action="create"]').click();
  await page.locator('#create-form [name="name"]').fill("Le salon d’Alice");
  await page.locator(".advanced summary").click();
  await page.locator('#create-form [name="target"]').fill("100");
  await page.locator("#create-form .cta").click();
  await expect(page.locator(".room-title")).toHaveText("Le salon d’Alice");
  for (const s of [1, 2, 3]) await page.locator(`[data-action="bot"][data-seat="${s}"]`).click();
  await expect(page.locator(".room-seat .bot-badge")).toHaveCount(3);
  await page.screenshot({ path: `${shots}salon-vip.png` });
  await page.locator('[data-action="start"]').click();
  await expect(page.locator(".hand .hcard")).toHaveCount(8);
  let summaryShot = false;
  for (let guard = 0; guard < 600; guard++) {
    const g = await game(page);
    if (g.phase === "finished") break;
    if (g.phase === "bidding" && g.turn === 0) await page.locator(g.contract ? ".pass-btn" : '.suit-btn[value="H"]').click().catch(() => {});
    else if (g.phase === "playing" && g.turn === 0 && g.legal.length && !(await page.locator(".collecting").count())) await playLegal(page).catch(() => {});
    else if (g.phase === "summary") {
      if (!summaryShot) await page.screenshot({ path: `${shots}fin-de-donne.png` });
      summaryShot = true;
      await page.locator('[data-action="next"]').click().catch(() => {});
    }
    await page.waitForTimeout(120);
  }
  await expect(page.locator(".summary")).toContainText(/Victoire|Défaite/, { timeout: 20000 });
  await page.locator('[data-action="menu"]').click();
  await page.locator('.sheet [data-action="scores"]').click();
  await expect(page.locator(".st-total")).toBeVisible();
  await page.locator(".sheet-close").click();
  await page.locator('[data-action="rematch"]').click();
  await expect(page.locator(".hand .hcard")).toHaveCount(8);
});

test("jouer maintenant : recherche, robots ajoutés, départ remplacé par un robot", async ({ browser }) => {
  const a = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const b = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await a.goto("/");
  await a.locator('.hero [data-action="quick"]').click();
  await expect(a.locator(".room-center")).toContainText("On cherche des joueurs");
  await b.goto("/");
  await b.locator('.hero [data-action="quick"]').click();
  await expect(a.locator(".room-seat:not(.empty)")).toHaveCount(2);
  await expect(a.locator(".fill-timer")).toBeVisible();
  await a.screenshot({ path: `${shots}recherche-joueurs.png` });
  await expect(a.locator(".hand .hcard")).toHaveCount(8, { timeout: 20000 });
  await expect(a.locator(".seat .bot-badge")).toHaveCount(2);
  await b.locator('[data-action="menu"]').click();
  await b.locator('[data-action="quitGame"]').click();
  await expect(b.locator("#modal")).toContainText("Un robot prendra votre place");
  await b.screenshot({ path: `${shots}quitter-confirmation.png` });
  await b.locator('[data-action="confirmLeave"]').click();
  await expect(b.locator(".hero")).toBeVisible();
  await expect(a.locator(".seat .bot-badge")).toHaveCount(3);
  await expect(a.locator(".arena")).toContainText("remplace");
  await expect(a.locator(".hand .hcard")).toHaveCount(8);
  await a.waitForTimeout(400);
  await a.screenshot({ path: `${shots}robot-remplacant.png` });
});

test("table VIP : invitation par lien, acceptation, reconnexion", async ({ browser }) => {
  const host = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await spy(host);
  await host.goto("/");
  await host.locator('.tiles [data-action="create"]').click();
  await host.locator('#create-form [name="name"]').fill("Salon mobile");
  await host.locator("#create-form .cta").click();
  await expect(host.locator(".room-title")).toHaveText("Salon mobile");
  await host.reload();
  await expect(host.locator(".room-title")).toHaveText("Salon mobile");
  const { id, invite } = await host.evaluate(() => window.__beloteState.table);
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guest = await guestCtx.newPage();
  await guest.goto("/#" + encodeURIComponent(JSON.stringify({ tableId: id, invite })));
  await expect(guest.locator("#invite-form")).toBeVisible();
  await guest.locator("#invite-form .cta").click();
  await expect(guest.locator("#modal")).toContainText("1000");
  await guest.locator('[data-action="confirmVip"]').click();
  await expect(host.locator(".request")).toBeVisible();
  await host.screenshot({ path: `${shots}vip-demande.png` });
  await host.locator('[data-action="admit"]').click();
  await expect(guest.locator(".room-title")).toHaveText("Salon mobile");
  await host.locator('[data-action="bot"]').first().click();
  await host.locator('[data-action="bot"]').first().click();
  await host.locator('[data-action="start"]').click();
  await expect(guest.locator(".hand .hcard")).toHaveCount(8);
  await guest.reload();
  await expect(guest.locator(".hand .hcard")).toHaveCount(8);
  await guestCtx.close();
});

test("compte : inscription, choix d’avatar, profil", async ({ page }) => {
  await page.goto("/");
  await page.locator('.nav-actions [data-action="auth"]').click();
  await page.locator('#modal [data-mode="register"]').click();
  await expect(page.locator(".social.apple")).toBeVisible();
  await page.screenshot({ path: `${shots}inscription.png` });
  await page.locator('#register-form [name="email"]').fill(`sophie${Date.now()}@exemple.fr`);
  await page.locator('#register-form [name="password"]').fill("motdepasse");
  await page.locator("#register-form .cta").click();
  await expect(page.locator("#modal")).toContainText("Choisissez votre avatar");
  await page.locator('[data-avatar="hibou"]').click();
  await page.locator('#modal .cta[data-action="close"]').click();
  await expect(page.locator(".profile-chip img")).toHaveAttribute("src", "/avatars/hibou.svg");
  await page.locator(".profile-chip").click();
  await page.locator('#profile-form [name="name"]').fill("Sophie");
  await page.locator("#profile-form .pill").click();
  await expect(page.locator(".profile-chip")).toContainText("Sophie");
  await expect(page.locator(".account-box")).toContainText("@exemple.fr");
  await page.screenshot({ path: `${shots}profil.png` });
});
