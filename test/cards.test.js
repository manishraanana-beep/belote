import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { card, cardImage } from "../public/cards.js";
const svg = (c) =>
  readFileSync(new URL(`../public${cardImage(c).split("?")[0].replace(".webp", ".svg")}`, import.meta.url), "utf8"); // dessin source (le WebP en est tiré)
const suitIds = { S: "spade", H: "heart", C: "club", D: "diamond" };
// Symboles centraux des cartes épurées (scale 1.42 ; 3.1 pour l'As).
const big = (c) => (svg(c).match(/scale\((?:1\.42|3\.1)\)/g) ?? []).length;
test("sept à dix : nombre exact de symboles centraux pour chaque couleur", () => {
  for (const s of ["S", "H", "C", "D"])
    for (const n of [7, 8, 9, 10]) assert.equal(big(n + s), n, `${n}${s}`);
});
test("32 illustrations autonomes, compatibles CSP, index français", () => {
  for (const s of ["S", "H", "C", "D"])
    for (const r of ["7", "8", "9", "10", "J", "Q", "K", "A"]) {
      const x = svg(r + s);
      assert.doesNotMatch(x, /style=|<script|href="(?!#)/);
      const refs = [...x.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
      for (const id of refs) assert.match(x, new RegExp(`id="${id}"`), `${r}${s} #${id}`);
      const label = { J: "V", Q: "D", K: "R" }[r] ?? r;
      assert.equal((x.match(new RegExp(`>${label}</text>`, "g")) ?? []).length, 2);
    }
  assert.equal(big("AH"), 1);
});
test("rendu HTML sans suggestion de carte", () => {
  assert.match(card("QS"), /src="\/cards\/QS\.webp(\?v=[\w-]+)?"/);
  assert.match(card("QS"), /aria-label="Dame de pique"/);
  assert.doesNotMatch(card("7H", { play: true }), /playable/);
  assert.match(card("7H", { play: true }), /data-action="play"/);
  assert.throws(() => card("6H"));
});
test("astuces : plus de 100, classées, courtes, sans répétition rapprochée", async () => {
  const { TIPS, TIP_CATEGORIES, nextTip } = await import("../public/tips.js");
  assert.ok(TIPS.length >= 100);
  for (const [cat, text] of TIPS) {
    assert.ok(TIP_CATEGORIES[cat], cat);
    assert.ok(text.length <= 110, text);
  }
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(nextTip(store).text);
  assert.equal(seen.size, 30);
});
