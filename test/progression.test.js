import test from "node:test";
import assert from "node:assert/strict";
import { createEconomy, economyConfig, toCredits } from "../src/economy.js";
import { createProgression, levelInfo } from "../src/progression.js";

const setup = () => {
  const db = { players: {} };
  const economy = createEconomy(db, economyConfig({}));
  return { db, economy, prog: createProgression({ db, economy, env: {} }) };
};
const game = (over = {}) => ({ practice: false, won: false, rubicon: false, deals: 4, durationMs: 600000, lineup: "a|b|c|d", ...over });

test("niveaux : la participation fait progresser, perdre des crédits ne fait rien perdre", () => {
  const { prog, economy } = setup();
  const p = { id: "p", accountId: "acc" };
  const r = prog.record(p, game({ won: true }));
  assert.ok(r.xp > 0);
  const xp = p.progress.xp;
  economy.post(p, "x", "seed", 0);
  assert.equal(p.progress.xp, xp);
  assert.equal(levelInfo(0).name, "Débutant");
  assert.equal(levelInfo(400).name, "Habitué");
  assert.ok(p.progress.badges["first-win"]);
});
test("défis : récompense attribuée une seule fois, tablée répétée plafonnée, parties trop courtes exclues", () => {
  const { prog, db } = setup();
  const p = { id: "p", accountId: "acc" };
  prog.record(p, game({ lineup: "x" }));
  prog.record(p, game({ lineup: "x" }));
  const third = prog.record(p, game({ lineup: "x" }));
  assert.equal(third.counted, false, "troisième partie avec la même tablée non comptée");
  prog.record(p, game({ lineup: "y", deals: 1, durationMs: 1000 })); // trop courte
  let v = prog.view(p).challenges.find((c) => c.id === "play3");
  assert.equal(v.progress, 2);
  const done = prog.record(p, game({ lineup: "z", won: true }));
  assert.deepEqual(done.challenges.map((c) => c.id).sort(), ["play3", "win1"]);
  prog.record(p, game({ lineup: "w", won: true }));
  const rewards = db.ledger.filter((x) => x.type === "challenge");
  assert.equal(rewards.length, 2, "une récompense par défi");
  assert.equal(toCredits(rewards.reduce((a, x) => a + x.amount, 0)), 250);
  v = prog.view(p);
  assert.ok(v.nextReset > Date.now());
});
test("collection : éléments verrouillés, débloqués par défi, équipement vérifié", () => {
  const { prog } = setup();
  const p = { id: "p" };
  assert.throws(() => prog.equip(p, "back-menthe"), /Verrouillé/);
  prog.record(p, game({ practice: true }));
  prog.equip(p, "back-menthe");
  assert.equal(p.progress.equipped.back, "back-menthe");
  assert.throws(() => prog.equip(p, "felt-lagon"), /Verrouillé/);
});

test("Vainqueur à Las Vegas et objets Membre Prestige", () => {
  const { prog } = setup();
  const p = { id: "p", accountId: "acc" };
  prog.record(p, game({ won: true, vegas: false }));
  assert.ok(!p.progress.badges["vegas-winner"]);
  prog.record(p, game({ won: false, vegas: true, lineup: "e|f|g|h" }));
  assert.ok(!p.progress.badges["vegas-winner"], "il faut gagner");
  prog.record(p, game({ won: true, vegas: true, lineup: "i|j|k|l" }));
  assert.ok(p.progress.badges["vegas-winner"]);
  assert.throws(() => prog.equip(p, "voice-sport"), /Membre Prestige/);
  p.prestige = { until: Date.now() + 86400_000 };
  prog.equip(p, "voice-sport");
  assert.equal(prog.shown(p, "voice"), "voice-sport");
  p.prestige.until = Date.now() - 1; // abonnement terminé : retour à la voix de base
  assert.equal(prog.shown(p, "voice"), null);
});
