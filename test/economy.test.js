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
test("rubicon : signalé, mais la perte reste limitée à la mise", () => {
  const r = computeSettlement(money(200, [200, 200, 200, 200]), [1001, 500]);
  assert.equal(r.rubicon, true);
  assert.deepEqual(credits(r), [200, -200, 200, -200]);
  assert.equal(computeSettlement(money(200, [200, 200, 200, 200]), [1000, 500]).rubicon, false);
});
test("réservation : seulement la mise ; règlement unique et équilibré", () => {
  const db = { players: {} };
  const eco = createEconomy(db, { ...economyConfig({ BELOTE_TABLE_FEE_PCT: "0" }), dayStartUtc: 3 });
  const players = [200, 350, 1000, 5000].map((c, i) => {
    const p = { id: "p" + i, name: "J" + i, accountId: "a" + i };
    eco.post(p, "seed:" + i, "seed", toUnits(c));
    db.players[p.id] = p;
    return p;
  });
  const m = eco.reserve({ stake: 200, gameId: "g1" }, players);
  assert.deepEqual(m.seats.map((s) => toCredits(s.engaged)), [200, 200, 200, 200]);
  assert.deepEqual(players.map((p) => toCredits(eco.available(p))), [0, 150, 800, 4800]);
  eco.post(players[1], "purchase:test:x", "purchase", toUnits(1000));
  const r = eco.settle(db.players, m, [300, 1100], "g1");
  assert.deepEqual(credits(r), [-200, 200, -200, 200]);
  assert.deepEqual(players.map((p) => toCredits(p.wallet.balance)), [0, 1550, 800, 5200]);
  assert.deepEqual(players.map((p) => p.wallet.reserved), [0, 0, 0, 0]);
  assert.equal(eco.settle(db.players, m, [300, 1100], "g1"), null, "réglé une seule fois");
  for (const p of players) assert.ok(p.wallet.balance >= 0);
});
test("abandon : la mise est perdue tout de suite, même si l'équipe gagne ensuite", () => {
  const db = { players: {} };
  const eco = createEconomy(db, economyConfig({ BELOTE_TABLE_FEE_PCT: "0" }));
  const players = [1000, 1000, 1000, 1000].map((c, i) => {
    const p = { id: "p" + i, name: "J" + i };
    eco.post(p, "seed:" + i, "seed", toUnits(c));
    db.players[p.id] = p;
    return p;
  });
  const m = eco.reserve({ stake: 200, gameId: "g" }, players);
  eco.forfeit(db.players, m, "p0", "g");
  assert.equal(toCredits(players[0].wallet.balance), 800);
  assert.equal(players[0].wallet.reserved, 0);
  const r = eco.settle(db.players, m, [1100, 300], "g"); // équipe de J0 gagne
  assert.ok(!r.rows.some((x) => x.pid === "p0"));
  assert.deepEqual(players.map((p) => toCredits(p.wallet.balance)), [800, 800, 1200, 800]);
});
test("annulation technique : réservations libérées sans gain ni perte", () => {
  const db = { players: {} };
  const eco = createEconomy(db, economyConfig({ BELOTE_TABLE_FEE_PCT: "0" }));
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
test("roue du jour : un tour par 24 h, case tirée par le serveur, série de jours", () => {
  const db = { players: {} };
  const eco = createEconomy(db, economyConfig({ BELOTE_TABLE_FEE_PCT: "0" }));
  const p = { id: "p", accountId: "a" };
  const H = 3600_000,
    t0 = Date.UTC(2026, 2, 28, 22);
  const first = (r) => () => r; // tirage imposé (0 = première case, ×0,5)
  let e = eco.loginBonus(p, t0, first(0));
  assert.deepEqual([e.segment, e.streak, e.amount], [0, 1, toUnits(100)]); // 200 × 0,5 × 1
  assert.equal(eco.loginBonus(p, t0 + 23 * H, first(0)), null); // pas deux tours en 24 h
  // Lendemain : série 2 (×1,25), case « ×1 » (deuxième case).
  e = eco.loginBonus(p, t0 + 24 * H, () => 0.25);
  assert.deepEqual([e.segment, e.streak, e.amount], [1, 2, toUnits(250)]);
  // Jackpot (dernière case ×10) au 3e jour (×1,5).
  e = eco.loginBonus(p, t0 + 48 * H, () => 0.999);
  assert.deepEqual([e.segment, e.streak, e.amount], [7, 3, toUnits(3000)]);
  // Absence de plus de 48 h : la série repart à 1.
  e = eco.loginBonus(p, t0 + 48 * H + 72 * H, first(0));
  assert.equal(e.streak, 1);
  assert.equal(eco.loginBonus({ id: "invite" }, t0), null); // compte requis
  // Tirage réel : toujours une case valide.
  const q = { id: "q", accountId: "b" };
  for (let i = 0; i < 30; i++) {
    const r = eco.loginBonus(q, t0 + i * 24 * H);
    assert.ok(r.segment >= 0 && r.segment < 8 && r.amount > 0);
  }
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

test("droit de table : 10 % de la mise payé à l'entrée, retiré de la circulation, rendu si la partie est annulée", () => {
  const db = { players: {} };
  const eco = createEconomy(db, economyConfig({}));
  assert.equal(eco.tableFee(1000), 100);
  assert.equal(eco.tableFee(0), 0);
  const players = [1100, 1100, 1100, 1099].map((c, i) => {
    const p = { id: "p" + i, name: "J" + i };
    eco.post(p, "seed:" + i, "seed", toUnits(c));
    db.players[p.id] = p;
    return p;
  });
  assert.throws(() => eco.reserve({ stake: 1000, gameId: "g0" }, players), /pas assez/); // 1 099 < 1 000 + 100
  eco.post(players[3], "seed:plus", "seed", toUnits(1));
  const m = eco.reserve({ stake: 1000, gameId: "g1" }, players);
  assert.deepEqual(players.map((p) => toCredits(p.wallet.balance)), [1000, 1000, 1000, 1000]);
  eco.settle(db.players, m, [1100, 300], "g1");
  const total = players.reduce((a, p) => a + toCredits(p.wallet.balance), 0);
  assert.equal(total, 4400 - 400, "les 4 droits de table sont sortis de la circulation");
  players.forEach((p, i) => eco.post(p, "seed2:" + i, "seed", toUnits(1000)));
  const m2 = eco.reserve({ stake: 200, gameId: "g2" }, players);
  eco.release(db.players, m2);
  assert.equal(players.reduce((a, p) => a + toCredits(p.wallet.balance), 0), 8000, "annulation : droit rendu");
});
test("roue du jour : 10 jours d'affilée, et jamais bloquée si le compteur a pris du retard", () => {
  const db = { players: {} };
  const eco = createEconomy(db, economyConfig({ BELOTE_TABLE_FEE_PCT: "0" }));
  const p = { id: "p", accountId: "a" };
  const H = 3600_000,
    t0 = Date.UTC(2026, 9, 1, 10);
  for (let d = 0; d < 10; d++) assert.ok(eco.loginBonus(p, t0 + d * 25 * H, () => 0), `jour ${d + 1}`);
  // Joueur restauré d'une ancienne sauvegarde alors que le registre contient déjà les tours suivants.
  p.loginBonusSeq = 6;
  const e = eco.loginBonus(p, t0 + 10 * 25 * H, () => 0);
  assert.ok(e);
  assert.equal(p.loginBonusSeq, 11);
  assert.equal(typeof eco.view(p).loginBonus.wait, "number");
});
