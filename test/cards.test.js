import test from "node:test";
import assert from "node:assert/strict";
import { card } from "../public/cards.js";
test("sept à dix : nombre exact de symboles centraux pour chaque couleur", () => {
  for (const s of ["S", "H", "C", "D"])
    for (const n of [7, 8, 9, 10]) {
      const html = card(n + s);
      assert.equal((html.match(/class="card-pip"/g) ?? []).length, n);
      assert.equal((html.match(/class="corner/g) ?? []).length, 2);
    }
});
test("as et figures illustrés, sans suggestion de carte", () => {
  assert.equal((card("AH").match(/class="card-pip"/g) ?? []).length, 1);
  for (const r of ["J", "Q", "K"]) assert.match(card(r + "S"), /court-art/);
  assert.doesNotMatch(card("7H", { play: true }), /playable/);
  assert.match(card("7H", { play: true }), /data-action="play"/);
});
