import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStorage } from "../src/storage.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "belote-storage-"));
const sample = () => ({
  players: { p1: { id: "p1", name: "Jacko", wallet: { balance: 4000, reserved: 0 } }, p2: { id: "p2", name: "Bime", wallet: { balance: 1000, reserved: 200 } } },
  accounts: { a1: { id: "a1", email: "j@exemple.fr", playerId: "p1" } },
  tables: {},
  tournaments: { t1: { id: "t1", name: "Coupe" } },
  settings: { maintenance: false, loginBonus: 200 },
  ledger: [
    { id: "e1", key: "signup:p1", pid: "p1", type: "bonus", amount: 4000, balance: 4000, at: 1 },
    { id: "e2", key: "signup:p2", pid: "p2", type: "bonus", amount: 1000, balance: 1000, at: 2 },
  ],
  ledgerKeys: { "signup:p1": "e1", "signup:p2": "e2" },
});

test("migration de state.json vers SQLite : sans perte, ancien fichier conservé", () => {
  const d = dir();
  try {
    writeFileSync(path.join(d, "state.json"), JSON.stringify(sample()));
    const s = openStorage({ dataDir: d, now: () => Date.UTC(2026, 9, 28) });
    const db = s.load();
    assert.equal(Object.keys(db.players).length, 2);
    assert.equal(db.players.p2.wallet.reserved, 200);
    assert.equal(db.ledger.length, 2);
    assert.deepEqual(db.ledgerKeys, sample().ledgerKeys);
    assert.equal(db.migration.ok, true);
    assert.equal(db.migration.balance, 5000);
    assert.ok(!existsSync(path.join(d, "state.json")), "state.json renommé");
    assert.ok(readdirSync(d).some((f) => f.startsWith("state.json.migre-")), "ancien fichier conservé");
    s.close();
    // Redémarrage : les données viennent de SQLite, sans nouvelle migration.
    const s2 = openStorage({ dataDir: d });
    const again = s2.load();
    assert.equal(again.players.p1.name, "Jacko");
    assert.equal(again.ledger.length, 2);
    s2.close();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("enregistrements successifs : seules les modifications sont écrites, journal sans doublon", () => {
  const d = dir();
  try {
    const s = openStorage({ dataDir: d });
    assert.equal(s.load(), null, "base vide au départ");
    const db = sample();
    s.save(db);
    db.players.p1.wallet.balance = 4200;
    db.ledger.push({ id: "e3", key: "wheel:p1:1", pid: "p1", type: "roue", amount: 200, balance: 4200, at: 3 });
    db.ledgerKeys["wheel:p1:1"] = "e3";
    s.save(db);
    s.save(db); // une seconde fois : rien de plus
    delete db.tournaments;
    s.save(db);
    s.close();
    const s2 = openStorage({ dataDir: d });
    const back = s2.load();
    assert.equal(back.players.p1.wallet.balance, 4200);
    assert.deepEqual(back.ledger.map((e) => e.id), ["e1", "e2", "e3"]);
    assert.equal(back.ledgerKeys["wheel:p1:1"], "e3");
    assert.equal(back.tournaments, undefined, "collection supprimée");
    s2.close();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("une écriture en échec est annulée en entier (tout ou rien)", () => {
  const d = dir();
  try {
    const s = openStorage({ dataDir: d });
    const db = sample();
    s.save(db);
    db.players.p1.wallet.balance = 9999;
    // Deux mouvements avec la même clé unique : la transaction échoue et rien n'est écrit.
    db.ledger.push({ id: "e4", key: "dup", pid: "p1", amount: 1, at: 4 }, { id: "e5", key: "dup", pid: "p1", amount: 1, at: 5 });
    const bad = { ...db, settings: { toJSON() { throw Error("panne"); } } };
    assert.throws(() => s.save(bad), /panne/);
    s.close();
    const back = openStorage({ dataDir: d }).load();
    assert.equal(back.players.p1.wallet.balance, 4000, "aucune modification partielle");
    assert.equal(back.ledger.length, 2);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("retour arrière possible : BELOTE_STORAGE=json garde l'ancien fichier", () => {
  const d = dir();
  try {
    const s = openStorage({ dataDir: d, mode: "json" });
    assert.equal(s.kind, "json");
    s.save(sample());
    assert.ok(existsSync(path.join(d, "state.json")));
    assert.equal(openStorage({ dataDir: d, mode: "json" }).load().players.p1.name, "Jacko");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("après un échec, l'enregistrement suivant écrit bien tout ce qui manquait", () => {
  const d = dir();
  try {
    const s = openStorage({ dataDir: d });
    const db = sample();
    s.save(db);
    db.players.p1.wallet.balance = 7000;
    const bad = { ...db, settings: { toJSON() { throw Error("panne"); } } };
    assert.throws(() => s.save(bad), /panne/);
    s.save(db); // nouvelle tentative normale
    s.close();
    assert.equal(openStorage({ dataDir: d }).load().players.p1.wallet.balance, 7000);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
