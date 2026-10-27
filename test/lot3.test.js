import test from "node:test";
import assert from "node:assert/strict";
import { mailKey } from "../src/accounts.js";
import { createIntegrity, integrityConfig } from "../src/integrity.js";

test("adresses Gmail : points et « + » mènent à la même boîte", () => {
  assert.equal(mailKey("j.a.ck+bonus@gmail.com"), "jack@gmail.com");
  assert.equal(mailKey("Jack@GoogleMail.com"), "jack@gmail.com");
  assert.equal(mailKey("j.ack+x@orange.fr"), "j.ack+x@orange.fr", "les autres fournisseurs ne changent pas");
});

test("anti-triche : jetons à sens unique entre deux comptes, même avec des partenaires différents", () => {
  const db = {};
  const it = createIntegrity(db, integrityConfig({}));
  let a = null;
  for (let i = 0; i < 6; i++) {
    const rows = [{ pid: "gagnant", delta: 2000 }, { pid: `ami${i}`, delta: 2000 }, { pid: "donneur", delta: -2000 }, { pid: `x${i}`, delta: -2000 }];
    a = it.settlement(`g${i}`, { rows, total: 4000 }) ?? a;
  }
  assert.ok(a, "alerte levée");
  assert.equal(a.kind, "Jetons transférés à sens unique entre deux comptes");
  assert.deepEqual(a.players, ["gagnant", "donneur"]);
  assert.equal(db.alerts.filter((x) => x.key.startsWith("pair:")).length, 1, "une alerte par paire, mise à jour");
});

test("anti-triche : parties équilibrées entre deux comptes, pas d'alerte", () => {
  const db = {};
  const it = createIntegrity(db, integrityConfig({}));
  for (let i = 0; i < 8; i++) {
    const [w, l] = i % 2 ? ["a", "b"] : ["b", "a"];
    it.settlement(`g${i}`, { rows: [{ pid: w, delta: 1000 }, { pid: `p${i}`, delta: 1000 }, { pid: l, delta: -1000 }, { pid: `q${i}`, delta: -1000 }], total: 2000 });
  }
  assert.equal(db.alerts.length, 0);
});
