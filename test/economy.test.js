import test from "node:test";
import assert from "node:assert/strict";
import { computeSettlement, createEconomy, economyConfig, toUnits, toCredits, verifyStripeSignature } from "../src/economy.js";
import { createHmac } from "node:crypto";

const money = (stake, engaged) => ({
  stake: toUnits(stake),
  seats: engaged.map((c, seat) => ({ seat, pid: "p" + seat, name: "J" + seat, engaged: toUnits(c) })),
});
const credits = (r) => r.rows.sort((a, b) => a.seat - b.seat).map((x) => toCredits(x.delta));

test("victoire simple : chaque perdant perd la mise, chaque gagnant gagne la mise", () => {
  const r = computeSettlement(money(200, [600, 600, 600, 600]), [1010, 700]);
  assert.equal(r.rubicon, false);
  assert.deepEqual(credits(r), [200, -200, 200, -200]);
});
test("rubicon : strictement plus du double ; égalité au double = victoire simple", () => {
  assert.deepEqual(credits(computeSettlement(money(200, [600, 600, 600, 600]), [1001, 500])), [400, -400, 400, -400]);
  assert.equal(computeSettlement(money(200, [600, 600, 600, 600]), [1000, 500]).rubicon, false);
  assert.deepEqual(credits(computeSettlement(money(200, [600, 600, 600, 600]), [1000, 500])), [200, -200, 200, -200]);
});
test("rubicon (double de la mise) avec adversaires peu engagés : 350 + 400 = 750, soit 375 par gagnant", () => {
  const r = computeSettlement(money(200, [600, 350, 1000 / 1000 * 600, 500]), [1200, 300]);
  assert.deepEqual(credits(r), [375, -350, 375, -400]);
  assert.equal(r.rows.find((x) => x.seat === 0).adjusted, true);
});
test("montant impair : demi-crédits exacts, rien n'est créé", () => {
  const r = computeSettlement(money(100, [300, 150.5, 300, 300]), [1100, 100]);
  // 150,5 + 200 = 350,5 : le dernier demi-crédit ne se partage pas, il n'est pas prélevé → 175 chacun.
  const d = credits(r);
  assert.equal(d.reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(d, [175, -150.5, 175, -199.5]);
  const r2 = computeSettlement(money(100, [300, 150.5, 300, 151]), [1100, 100]);
  assert.deepEqual(credits(r2), [150.5, -150.5, 150.5, -150.5]);
});
test("réservation : min(solde disponible, 2 × mise) ; règlement unique et équilibré", () => {
  const db = { players: {} };
  const eco = createEconomy(db, { ...economyConfig({}), dayStartUtc: 3 });
  const players = [200, 350, 1000, 5000].map((c, i) => {
    const p = { id: "p" + i, name: "J" + i, accountId: "a" + i };
    eco.post(p, "seed:" + i, "seed", toUnits(c));
    db.players[p.id] = p;
    return p;
  });
  const t = { stake: 200, gameId: "g1" };
  const m = eco.reserve(t, players);
  assert.deepEqual(m.seats.map((s) => toCredits(s.engaged)), [200, 350, 400, 400]);
  assert.deepEqual(players.map((p) => toCredits(eco.available(p))), [0, 0, 600, 4600]);
  // Un achat pendant la partie ne change pas les montants engagés.
  eco.post(players[1], "purchase:test:x", "purchase", toUnits(1000));
  const r = eco.settle(db.players, m, [300, 1100], "g1"); // équipe 1 (J1, J3) gagne en rubicon
  assert.equal(r.rubicon, true);
  assert.deepEqual(credits(r), [-200, 300, -400, 300]);
  assert.deepEqual(players.map((p) => toCredits(p.wallet.balance)), [0, 1650, 600, 5300]);
  assert.deepEqual(players.map((p) => p.wallet.reserved), [0, 0, 0, 0]);
  assert.equal(eco.settle(db.players, m, [300, 1100], "g1"), null, "réglé une seule fois");
  const moved = db.ledger.filter((x) => x.gameId === "g1").reduce((a, x) => a + x.amount, 0);
  assert.equal(moved, 0, "prélevé = distribué");
  for (const p of players) assert.ok(p.wallet.balance >= 0);
});
test("annulation technique : réservations libérées sans gain ni perte", () => {
  const db = { players: {} };
  const eco = createEconomy(db, economyConfig({}));
  const players = [1000, 1000, 1000, 1000].map((c, i) => {
    const p = { id: "p" + i, name: "J" + i };
    eco.post(p, "seed:" + i, "seed", toUnits(c));
    db.players[p.id] = p;
    return p;
  });
  const m = eco.reserve({ stake: 500, gameId: "g" }, players);
  eco.release(db.players, m, "incident");
  assert.deepEqual(players.map((p) => [p.wallet.balance, p.wallet.reserved]), players.map(() => [toUnits(1000), 0]));
  assert.equal(eco.settle(db.players, m, [1000, 0], "g"), null);
});
test("bonus de connexion : immédiat, puis 24 h après la dernière attribution, sans cumul", () => {
  const db = { players: {} };
  const eco = createEconomy(db, economyConfig({}));
  const p = { id: "p", accountId: "a" };
  const H = 3600_000,
    t0 = Date.UTC(2026, 2, 28, 22); // veille du passage à l'heure d'été : l'heure du serveur (UTC) ne saute pas
  assert.equal(eco.loginBonus(p, t0).amount, toUnits(200)); // première connexion
  assert.equal(eco.loginBonus(p, t0), null); // connexion simultanée sur un autre appareil
  assert.equal(eco.loginBonus(p, t0 + 23 * H + 59 * 60_000), null);
  assert.ok(eco.loginBonus(p, t0 + 24 * H)); // exactement 24 h après
  assert.equal(eco.loginBonus(p, t0 + 30 * H), null);
  assert.ok(eco.loginBonus(p, t0 + 24 * H + 10 * 24 * H)); // absence de dix jours : un seul bonus
  assert.equal(eco.loginBonus(p, t0 + 24 * H + 10 * 24 * H + 1), null);
  assert.equal(p.wallet.balance, toUnits(600));
  assert.equal(eco.history(p).filter((x) => x.type === "login").length, 3);
  assert.equal(eco.loginBonus({ id: "invite" }, t0), null); // compte requis
  // Montant modifié depuis l'administration ; les crédits engagés ne bougent pas.
  db.settings.loginBonus = 500;
  p.wallet.reserved = toUnits(300);
  eco.loginBonus(p, t0 + 100 * H + 10 * 24 * H);
  assert.deepEqual([p.wallet.balance, p.wallet.reserved], [toUnits(1100), toUnits(300)]);
  assert.equal(eco.view(p).loginBonus.amount, 500);
});
test("signature Stripe vérifiée", () => {
  const raw = '{"x":1}',
    t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", "whsec").update(`${t}.${raw}`).digest("hex");
  assert.equal(verifyStripeSignature(raw, `t=${t},v1=${sig}`, "whsec"), true);
  assert.equal(verifyStripeSignature(raw + " ", `t=${t},v1=${sig}`, "whsec"), false);
  assert.equal(verifyStripeSignature(raw, `t=${t - 4000},v1=${sig}`, "whsec"), false);
});
test("achats désactivés par défaut, boutique de test jamais en production", () => {
  assert.equal(economyConfig({}).purchases, false);
  assert.equal(economyConfig({ BELOTE_TEST_SHOP: "on" }).testShop, true);
  assert.equal(economyConfig({ BELOTE_TEST_SHOP: "on", NODE_ENV: "production" }).testShop, false);
  assert.equal(economyConfig({ BELOTE_TEST_SHOP: "on", RAILWAY_ENVIRONMENT: "production" }).testShop, false);
});

test("règlement avec les robots de la Maison : le joueur gagne ou perd contre la Maison", async () => {
  const { createEconomy, toUnits } = await import("../src/economy.js");
  const db = { players: {}, ledger: [], ledgerKeys: {}, settings: {} };
  const eco = createEconomy(db);
  const p = { id: "p1", wallet: { balance: toUnits(1000), reserved: 0 } };
  db.players.p1 = p;
  const money = eco.reserve({ stake: 200 }, [p, null, null, null], { house: true });
  assert.equal(money.seats.length, 4);
  const r = eco.settle(db.players, money, [1000, 300], "g1");
  assert.ok(r);
  assert.equal(p.wallet.reserved, 0);
  assert.ok(p.wallet.balance > toUnits(1000), "victoire : crédits versés par la Maison");
});
