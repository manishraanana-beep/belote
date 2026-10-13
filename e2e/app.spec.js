import { test, expect } from "@playwright/test";

const shots = "test-results/screens/";
// Expose le dernier état reçu pour choisir une carte autorisée (le test joue comme un humain).
async function spy(page) {
  await page.addInitScript(() => {
    localStorage.setItem("welcomed", "1");
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
  // Cherche un point réellement visible de la carte (les cartes sont inclinées et se chevauchent).
  const pos = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    for (const fy of [0.45, 0.3, 0.6, 0.2])
      for (const fx of [0.15, 0.3, 0.5, 0.7, 0.85, 0.08]) {
        const x = r.left + r.width * fx,
          y = r.top + r.height * fy;
        if (node.contains(document.elementFromPoint(x, y))) return { x: x - r.left, y: y - r.top };
      }
    return { x: r.width * 0.15, y: r.height * 0.45 };
  });
  await el.click({ position: pos, timeout: 4000 });
}
async function playLegal(page) {
  const g = await game(page);
  await tap(page.locator(`.hand [data-card="${g.legal[0]}"]`)); // une seule touche suffit
}
async function startPractice(page) {
  await spy(page);
  await page.goto("/");
  await page.locator('.feature[data-action="practice"]').click();
  await page.locator('[data-action="confirmPractice"]').click();
  await expect(page.locator(".hand .hcard")).toHaveCount(8);
}
async function bid(page, suit, amount) {
  if (amount) await page.locator(`.amount[data-amount="${amount}"]`).click({ timeout: 4000 });
  await page.locator(`.suit-btn[data-suit="${suit}"]`).click({ timeout: 4000 });
  await page.locator('#bid-form button[name="go"]').click({ timeout: 4000 });
}
async function createVip(page, name) {
  await page.goto("/");
  await page.locator(".feature.f-vip").click();
  await page.locator('[data-page="vipCreate"]').click();
  await page.locator('#create-form [name="name"]').fill(name);
  // Partie courte (100 points) : réglage et envoi dans le même instant, sans rafraîchissement entre les deux.
  await page.$eval("#create-form", (form) => {
    const r = form.querySelector('[name="target"][value="500"]');
    r.value = "100";
    r.checked = true;
    form.requestSubmit(form.querySelector("button.gold-btn"));
  });
  await expect(page.locator(".page-room .page-title")).toHaveText(name);
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
    await startPractice(page);
    await expect.poll(() => page.$$eval(".hand img", (i) => i.filter((x) => x.complete && x.naturalWidth).length)).toBe(8);
    const order = await page.$$eval(".hand .hcard", (b) => b.map((x) => x.dataset.card.slice(-1)));
    expect(order.join("")).toBe([...order].sort((a, b) => "SHCD".indexOf(a) - "SHCD".indexOf(b)).join(""));
    await expect(page.locator(".hand")).toHaveClass(/glow/);
    await page.waitForTimeout(700);
    await noScroll(page);
    await inView(page, ".hand .hcard");
    await inView(page, ".seat .seat-avatar");
    await inView(page, ".scoreboard");
    await inView(page, ".bid-panel .amount, .bid-panel .suit-btn, .bid-panel .bid-actions button");
    await inView(page, ".status-row .turn-pill");
    await page.screenshot({ path: `${shots}${name}-1-encheres.png` });
    await bid(page, "S", 90);
    const banner = page.locator(".contract-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText("a pris");
    await expect(banner).toContainText(/Votre équipe|Équipe adverse/);
    await expect(page.locator(".contract-pill")).not.toHaveClass(/pending/);
    await page.screenshot({ path: `${shots}${name}-2-preneur.png` });
    await noScroll(page);
    await expect.poll(async () => (await game(page)).phase, { timeout: 15000 }).toBe("playing");
    await expect.poll(async () => (await game(page)).legal.length, { timeout: 15000 }).toBeGreaterThan(0);
    const first = (await game(page)).legal[0];
    await page.screenshot({ path: `${shots}${name}-3-a-vous.png` });
    await tap(page.locator(`.hand [data-card="${first}"]`)); // une seule touche joue la carte
    await expect(page.locator(".trick .tcard").first()).toBeVisible();
    await expect(banner).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}${name}-4-pli.png` });
    await expect(page.locator('[data-action="lastTrick"]')).toBeEnabled({ timeout: 15000 });
    await page.waitForTimeout(1300);
    await page.locator('[data-action="lastTrick"]').click();
    await expect(page.locator(".sheet-lastTrick .lt-cards img")).toHaveCount(4);
    await expect(page.locator(".lt-contract")).toContainText(/Votre équipe|Équipe adverse/);
    await page.screenshot({ path: `${shots}${name}-5-dernier-pli.png` });
    await page.mouse.click(8, Math.round(viewport.height / 2));
    await expect(page.locator(".sheet")).toHaveCount(0);
    await noScroll(page);
    await inView(page, ".scoreboard b");
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

test("partie complète contre les robots, résultat et revanche", async ({ page }) => {
  test.setTimeout(240000);
  await spy(page);
  await createVip(page, "Le salon d’Alice");
  for (let i = 0; i < 3; i++) await page.locator('.stack [data-action="bot"]').click();
  await expect(page.locator(".slot .robot-tag")).toHaveCount(3);
  await page.screenshot({ path: `${shots}salon-vip.png` });
  await page.locator('[data-action="start"]').click();
  await expect(page.locator(".hand .hcard")).toHaveCount(8);
  let summaryShot = false;
  for (let guard = 0; guard < 900; guard++) {
    const g = await game(page);
    if (g.phase === "finished") break;
    if (g.phase === "bidding" && g.turn === 0) {
      if (g.contract) await page.locator('#bid-form [data-action="pass"]').click({ timeout: 4000 }).catch(() => {});
      else await bid(page, "H").catch(() => {});
    } else if (g.phase === "playing" && g.turn === 0 && g.legal.length && !(await page.locator(".collecting").count())) await playLegal(page).catch(() => {});
    else if (g.phase === "summary") {
      if (!summaryShot) await page.screenshot({ path: `${shots}fin-de-donne.png` });
      summaryShot = true;
      await page.locator('[data-action="next"]').click({ timeout: 4000 }).catch(() => {});
    }
    await page.waitForTimeout(120);
  }
  await expect(page.locator(".overlay-page.final .ribbon")).toContainText(/Victoire|Défaite/, { timeout: 20000 });
  await page.screenshot({ path: `${shots}victoire.png` });
  await page.locator('[data-action="rematchYes"]').click();
  await expect(page.locator(".hand .hcard")).toHaveCount(8);
});

test("jouer maintenant : recherche, robots ajoutés, départ remplacé par un robot", async ({ browser }) => {
  const a = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const b = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await spy(a);
  await spy(b);
  await a.goto("/");
  await a.locator('.page-home [data-action="quick"]').click();
  await expect(a.locator(".page-room .page-title")).toContainText("On cherche des joueurs");
  await b.goto("/");
  await b.locator('.page-home [data-action="quick"]').click();
  await expect(a.locator(".slot:not(.empty)")).toHaveCount(2);
  await expect(a.locator(".fill-timer")).toBeVisible();
  await a.screenshot({ path: `${shots}recherche-joueurs.png` });
  await expect(a.locator(".hand .hcard")).toHaveCount(8, { timeout: 20000 });
  await expect(a.locator(".seat .robot-tag")).toHaveCount(2);
  await b.locator('[data-action="menu"]').click();
  await b.locator('.sheet [data-action="quitGame"]').click();
  await expect(b.locator("#modal")).toContainText("Un robot prendra votre place");
  await b.screenshot({ path: `${shots}quitter-confirmation.png` });
  await b.locator('[data-action="confirmLeave"]').click();
  await expect(b.locator(".page-home")).toBeVisible();
  await expect(a.locator(".seat .robot-tag")).toHaveCount(3);
  await expect(a.locator(".arena")).toContainText("remplace");
  await expect(a.locator(".hand .hcard")).toHaveCount(8);
  await a.waitForTimeout(400);
  await a.screenshot({ path: `${shots}robot-remplacant.png` });
});

test("table VIP : code, invitation par lien, acceptation, reconnexion", async ({ browser }) => {
  const host = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await spy(host);
  await createVip(host, "Salon mobile");
  await expect(host.locator(".code-card .code b")).toHaveText(/^VIP-/);
  await host.screenshot({ path: `${shots}salon-prive.png` });
  await host.reload();
  await expect(host.locator(".page-room .page-title")).toHaveText("Salon mobile");
  const { id, invite } = await host.evaluate(() => window.__beloteState.table);
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guest = await guestCtx.newPage();
  await spy(guest);
  await guest.goto("/#" + encodeURIComponent(JSON.stringify({ tableId: id, invite })));
  await expect(guest.locator("#invite-form")).toBeVisible();
  await guest.locator("#invite-form button.gold-btn").click();
  await expect(guest.locator("#modal")).toContainText("100 points");
  await guest.locator('[data-action="confirmVip"]').click();
  await expect(host.locator(".request")).toBeVisible();
  await host.screenshot({ path: `${shots}vip-demande.png` });
  await host.locator('[data-action="admit"]').click();
  await expect(guest.locator(".page-room .page-title")).toHaveText("Salon mobile");
  await host.locator('.stack [data-action="bot"]').click();
  await host.locator('.stack [data-action="bot"]').click();
  await host.locator('[data-action="start"]').click();
  await expect(guest.locator(".hand .hcard")).toHaveCount(8);
  await guest.reload();
  await expect(guest.locator(".hand .hcard")).toHaveCount(8);
  await guestCtx.close();
});

test("compte : accueil, inscription, choix d’avatar, vérification, profil", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".page-welcome")).toBeVisible();
  await page.screenshot({ path: `${shots}bienvenue.png` });
  await page.locator('.page-welcome [data-page="register"]').click();
  await expect(page.locator(".social.apple")).toBeVisible();
  await page.screenshot({ path: `${shots}inscription.png` });
  await page.locator('#register-form [name="name"]').fill("Sophie");
  await page.locator('#register-form [name="email"]').fill(`sophie${Date.now()}@exemple.fr`);
  await page.locator('#register-form [name="password"]').fill("motdepasse");
  await page.locator('#register-form [name="terms"]').check({ force: true });
  await page.locator("#register-form button.gold-btn").click();
  await expect(page.locator(".page-title")).toHaveText("Choisir mon avatar");
  await page.locator('[data-avatar="chat"]').first().click();
  await page.locator('[data-action="useAvatar"]').click();
  // Sans envoi d'e-mails configuré, la vérification d'adresse est désactivée : direction l'accueil.
  await expect(page.locator(".page-home")).toBeVisible();
  await expect(page.locator('.notice-row:has-text("Confirmez")')).toHaveCount(0);
  await page.reload();
  await page.locator('.tabbar [data-page="profile"]').click();
  await expect(page.locator(".profile-hero h1")).toHaveText("Sophie");
  await expect(page.locator(".profile-hero img").first()).toHaveAttribute("src", "/avatars/chat.webp");
  await page.screenshot({ path: `${shots}profil.png` });
});
