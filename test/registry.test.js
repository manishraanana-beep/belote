import test from "node:test";
import assert from "node:assert/strict";
import { createEconomy, economyConfig, toUnits } from "../src/economy.js";
import { createRegistry } from "../src/registry.js";
import { stripeEvent } from "../src/purchases.js";
import { createHmac } from "node:crypto";

// Ancienne grille de packs : les montants de ces tests en dépendent.
const OLD_PACKS = "[{\"id\":\"pack-1000\",\"credits\":1000,\"price\":\"0,99 \u20ac\",\"priceCents\":99},{\"id\":\"pack-3000\",\"credits\":3000,\"price\":\"2,49 \u20ac\",\"priceCents\":249}]";
function setup() {
  const db = { players: { p1: { id: "p1", name: "Jacko", wallet: { balance: 0, reserved: 0 } } }, settings: {} };
  const economy = createEconomy(db, economyConfig({ BELOTE_PACKS: OLD_PACKS }));
  const registry = createRegistry({ db, economy, toUnits, packs: () => economy.config.packs, now: () => 1000 });
  return { db, economy, registry, p: db.players.p1 };
}

test("registre : un achat n'est crédité qu'une fois, même reçu ou réimporté plusieurs fois", () => {
  const { db, registry, p } = setup();
  const buy = { provider: "stripe", transactionId: "cs_1", packId: "pack-3000", paymentRef: "pi_1", amountCents: 249 };
  assert.equal(registry.record(p, buy).credited, true);
  assert.equal(registry.record(p, buy).credited, false);
  assert.equal(p.wallet.balance, toUnits(3000));
  assert.equal(Object.keys(db.purchases).length, 1);
  assert.equal(db.purchases["stripe:cs_1"].status, "paid");
  assert.equal(db.ledger.filter((e) => e.type === "purchase").length, 1);
  assert.throws(() => registry.record(p, { provider: "stripe", transactionId: "cs_x", packId: "inconnu" }), /Pack inconnu/);
});

test("registre : remboursement → jetons repris ; opposition sur des jetons dépensés → reste dû signalé", () => {
  const { economy, registry, p } = setup();
  registry.record(p, { provider: "stripe", transactionId: "cs_1", packId: "pack-1000", paymentRef: "pi_1", amountCents: 99 });
  registry.record(p, { provider: "stripe", transactionId: "cs_2", packId: "pack-3000", paymentRef: "pi_2", amountCents: 249 });
  const r1 = registry.reverse({ provider: "stripe", paymentRef: "pi_1", reason: "refund" });
  assert.equal(r1.status, "refunded");
  assert.equal(r1.recovered, 1000);
  assert.equal(p.wallet.balance, toUnits(3000));
  assert.equal(registry.reverse({ provider: "stripe", paymentRef: "pi_1" }), null, "pas de double reprise");
  // Le joueur a dépensé 2 500 jetons avant l'opposition : on reprend les 500 restants, 2 500 restent dus.
  economy.post(p, "spend", "mise", -toUnits(2500));
  const r2 = registry.reverse({ provider: "stripe", paymentRef: "pi_2", reason: "dispute" });
  assert.equal(r2.status, "disputed");
  assert.equal(r2.recovered, 500);
  assert.equal(r2.owed, 2500);
  assert.equal(p.wallet.balance, 0);
  const s = registry.summary();
  assert.deepEqual([s.count, s.paid, s.reversed, s.owed], [2, 0, 2, 2500]);
});

test("Stripe : notifications de paiement, de remboursement et d'opposition", () => {
  const env = { STRIPE_WEBHOOK_SECRET: "whsec_test" };
  const sign = (body) => {
    const t = Math.floor(Date.now() / 1000);
    return [body, `t=${t},v1=${createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}`];
  };
  let [b, sig] = sign(JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_9", payment_status: "paid", client_reference_id: "p1", metadata: { pack: "pack-1000" }, payment_intent: "pi_9", amount_total: 99, currency: "eur" } } }));
  assert.deepEqual(stripeEvent(b, sig, env), { kind: "paid", provider: "stripe", transactionId: "cs_9", playerId: "p1", packId: "pack-1000", paymentRef: "pi_9", amountCents: 99, currency: "eur" });
  [b, sig] = sign(JSON.stringify({ type: "charge.refunded", data: { object: { payment_intent: "pi_9" } } }));
  assert.deepEqual(stripeEvent(b, sig, env), { kind: "reverse", reason: "refund", provider: "stripe", paymentRef: "pi_9" });
  [b, sig] = sign(JSON.stringify({ type: "charge.dispute.created", data: { object: { payment_intent: "pi_9" } } }));
  assert.equal(stripeEvent(b, sig, env).reason, "dispute");
  assert.throws(() => stripeEvent(b, "t=1,v1=faux", env), /Signature invalide/);
});
