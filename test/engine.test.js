import test from "node:test";
import assert from "node:assert/strict";
import {
  strongestCard,
  newGame,
  act,
  view,
  legalCards,
  scoreDeal,
  botAction,
  nextDeal,
  expireCounter,
  winner,
  value,
} from "../src/engine.js";
test("fournir, couper, surcouper, partenaire maître et monter", () => {
  assert.deepEqual(
    legalCards(["7H", "JS"], [{ seat: 0, card: "AH" }], "S", 1),
    ["7H"],
  );
  assert.deepEqual(
    legalCards(["7D", "7S"], [{ seat: 0, card: "AH" }], "S", 1),
    ["7S"],
  );
  assert.deepEqual(
    legalCards(["7D", "7S"], [{ seat: 0, card: "AH" }], "S", 2),
    ["7D", "7S"],
  );
  assert.deepEqual(
    legalCards(
      ["7D", "7S", "JS"],
      [
        { seat: 0, card: "AH" },
        { seat: 1, card: "9S" },
      ],
      "S",
      2,
    ),
    ["JS"],
  );
  assert.deepEqual(
    legalCards(["7S", "JS"], [{ seat: 0, card: "9S" }], "S", 2),
    ["JS"],
  );
  assert.deepEqual(
    legalCards(
      ["7D", "7S"],
      [
        { seat: 0, card: "AH" },
        { seat: 1, card: "JS" },
      ],
      "S",
      2,
    ),
    ["7D", "7S"], // impossible de surcouper : pas d'obligation de sous-couper
  );
  assert.equal(
    winner(
      [
        { seat: 0, card: "AS" },
        { seat: 1, card: "9S" },
        { seat: 2, card: "JS" },
      ],
      "S",
    ),
    2,
  );
  assert.equal(value("JS", "S"), 20);
});
test("contre à la volée, droits, délai et enchère remplacée", () => {
  const g = newGame();
  act(g, 0, { type: "bid", amount: 80, suit: "S" });
  assert.throws(() => act(g, 2, { type: "counter" }));
  act(g, 1, { type: "bid", amount: 90, suit: "H" });
  assert.throws(() => act(g, 3, { type: "counter" }));
  act(g, 2, { type: "counter" }, 1000);
  assert.equal(g.phase, "counter");
  assert.throws(() => act(g, 2, { type: "bid", amount: 100, suit: "S" }));
  assert.throws(() => act(g, 2, { type: "surcounter" }, 1001));
  act(g, 3, { type: "surcounter" }, 1001);
  assert.equal(g.multiplier, 4);
  assert.equal(g.phase, "playing");
  const h = newGame();
  act(h, 0, { type: "bid", amount: 80, suit: "S" });
  act(h, 3, { type: "counter" }, 1000);
  assert.equal(expireCounter(h, 8999), false);
  assert.equal(expireCounter(h, 9000), true);
});
test("redistribution après quatre passes, 32 cartes distinctes et mains privées", () => {
  const g = newGame();
  for (let i = 0; i < 4; i++) act(g, i, { type: "pass" });
  assert.equal(g.deal, 2);
  assert.equal(new Set(g.hands.flat()).size, 32);
  assert.equal(view(g, 0).hand.length, 8);
  assert.equal("hands" in view(g, 0), false);
  assert.equal(view(g, null).hand.length, 0);
});
test("scores réussite, chute, belote, capot et multiplication", () => {
  const g = newGame({ beloteRetained: true });
  g.contract = { seat: 0, amount: 80, suit: "S" };
  g.points = [90, 72];
  assert.deepEqual(scoreDeal(g).score, [170, 72]);
  g.points = [70, 92];
  g.belote = [20, 0];
  assert.equal(scoreDeal(g).made, true);
  g.rules.beloteCountsContract = false;
  assert.deepEqual(scoreDeal(g).score, [20, 242]);
  g.multiplier = 2;
  assert.deepEqual(scoreDeal(g).score, [20, 484]);
  g.contract.amount = 250;
  g.points = [162, 0];
  g.tricks = Array.from({ length: 8 }, () => ({ winner: 0 }));
  assert.equal(scoreDeal(g).made, true);
  assert.deepEqual(scoreDeal(g).score, [844, 0]);
  g.tricks[0].winner = 1;
  assert.equal(scoreDeal(g).made, false);
});
test("parties complètes de robots sans accès caché, dix de der et fin de partie", () => {
  for (let n = 0; n < 20; n++) {
    const g = newGame({ target: 300 });
    let steps = 0;
    while (g.phase !== "finished" && steps++ < 20000) {
      if (g.phase === "summary") {
        nextDeal(g);
        continue;
      }
      if (g.phase === "counter") {
        expireCounter(g, Infinity);
        continue;
      }
      const v = view(g, g.turn);
      assert.equal("hands" in v, false);
      act(g, g.turn, botAction(v));
    }
    assert.equal(g.phase, "finished");
    for (const h of g.history) {
      assert.equal(h.points[0] + h.points[1], 162);
      assert.equal(h.tricks.length, 8);
    }
  }
});
test("belote et rebelote automatiques au jeu des deux cartes", () => {
  const g = newGame();
  g.phase = "playing";
  g.contract = { seat: 0, suit: "S", amount: 80 };
  g.hands = [
    ["KS", "QS"],
    ["7S", "8S"],
    ["9S", "JS"],
    ["10S", "AS"],
  ];
  g.turn = 0;
  act(g, 0, { type: "play", card: "KS" });
  assert.equal(g.lastEvent, "Belote !");
  g.trick = [];
  g.turn = 0;
  act(g, 0, { type: "play", card: "QS" });
  assert.equal(g.belote[0], 20);
});

test("historique public des enchères : passes, enchères, contre et surcontre", () => {
  const g = newGame();
  act(g, 0, { type: "pass" }, 1000);
  act(g, 1, { type: "bid", amount: 80, suit: "H" }, 2000);
  act(g, 2, { type: "counter" }, 3000);
  act(g, 3, { type: "surcounter" }, 4000);
  assert.deepEqual(
    view(g, 0).auction.map((a) => [a.seat, a.type]),
    [
      [0, "pass"],
      [1, "bid"],
      [2, "counter"],
      [3, "surcounter"],
    ],
  );
  assert.equal(g.auction[1].suit, "H");
  assert.equal(g.auction[1].amount, 80);
  const before = structuredClone(g.auction);
  assert.throws(() => act(g, 0, { type: "counter" }));
  assert.deepEqual(g.auction, before);
});

test("règles par défaut : belote perdue à la chute, donneur suivant si tous passent", () => {
  const g = newGame();
  assert.equal(g.rules.beloteRetained, false);
  assert.equal(g.rules.allPass, "rotate");
  assert.equal(g.rules.flyingCounter, true);
  assert.deepEqual([g.rules.target, g.rules.turnSeconds, g.rules.counterWindowSeconds, g.rules.capotValue, g.rules.reconnectSeconds, g.rules.scoring], [1500, 20, 8, 250, 90, "added"]);
});
test("temps écoulé : carte autorisée la plus forte", () => {
  assert.equal(strongestCard(["7H", "AH", "10H"], "S"), "AH");
  assert.equal(strongestCard(["AH", "7S"], "S"), "7S"); // l'atout l'emporte
  assert.equal(strongestCard(["AS", "9S", "JS"], "S"), "JS"); // valet d'atout
  assert.equal(strongestCard(["10D", "KD"], "S"), "10D");
});

test("robots : soutien du partenaire, pas de coupe sur le partenaire maître, pas de points donnés", () => {
  // Partenaire (siège 1) à 80 pique ; le robot (siège 3) a le Valet et deux As extérieurs : soutien.
  const base = { phase: "bidding", turn: 3, auction: [], tricks: [], trick: [], legal: [] };
  let a = botAction({ ...base, contract: { seat: 1, amount: 80, suit: "S" }, hand: ["JS", "7S", "AH", "AD", "8C", "9C", "7H", "8D"] });
  assert.deepEqual(a, { type: "bid", amount: 110, suit: "S" });
  // Main faible sans contrat : le robot passe au lieu d'annoncer.
  a = botAction({ ...base, contract: null, hand: ["7S", "8H", "9D", "7C", "8C", "QH", "KD", "7D"] });
  assert.equal(a.type, "pass");
  // Valet + 9 d'atout avec 4 atouts : annonce.
  a = botAction({ ...base, contract: null, hand: ["JH", "9H", "7H", "8H", "7C", "8C", "9D", "7D"] });
  assert.deepEqual(a, { type: "bid", amount: 90, suit: "H" });
  // Jeu : le partenaire (siège 1) a joué l'As de cœur maître, le robot (siège 3, dernier) n'a plus de cœur.
  const play = { phase: "playing", turn: 3, contract: { seat: 0, amount: 80, suit: "S" }, tricks: [], auction: [] };
  const trick = [{ seat: 0, card: "7H" }, { seat: 1, card: "AH" }, { seat: 2, card: "8H" }];
  a = botAction({ ...play, trick, hand: ["7S", "10C", "8D"], legal: ["7S", "10C", "8D"] });
  assert.equal(a.card, "10C", "il charge le pli du partenaire au lieu de couper");
  // Pli perdu face à un adversaire : la plus petite carte.
  const lost = [{ seat: 0, card: "AH" }, { seat: 1, card: "7H" }, { seat: 2, card: "8H" }];
  a = botAction({ ...play, contract: { seat: 1, amount: 80, suit: "S" }, trick: lost, hand: ["9H", "10H"], legal: ["9H", "10H"] });
  assert.equal(a.card, "9H");
});

test("capot non annoncé : annonce + 250 points", () => {
  const g = newGame();
  g.contract = { seat: 0, amount: 90, suit: "S" };
  g.multiplier = 1;
  g.points = [162, 0];
  g.belote = [0, 0];
  g.tricks = Array.from({ length: 8 }, () => ({ winner: 0, cards: [], points: 0 }));
  let r = scoreDeal(g);
  assert.deepEqual(r.score, [340, 0]);
  assert.equal(r.capot, true);
  // Contré : (annonce + 250) × 2.
  g.multiplier = 2;
  assert.deepEqual(scoreDeal(g).score, [680, 0]);
  // Sans capot : calcul habituel.
  g.multiplier = 1;
  g.tricks[7].winner = 1;
  g.points = [150, 12];
  r = scoreDeal(g);
  assert.equal(r.capot, false);
  assert.deepEqual(r.score, [240, 12]);
});

test("tout le monde passe : nouvelle donne, donneur suivant, partie en 1 500 points", () => {
  const g = newGame({});
  assert.equal(g.rules.target, 1500);
  const dealer = g.dealer;
  for (let i = 0; i < 4; i++) act(g, g.turn, { type: "pass" });
  assert.equal(g.dealer, (dealer + 1) % 4);
  assert.equal(g.deal, 2);
  assert.equal(g.phase, "bidding");
  assert.equal(g.allPassed, true);
  assert.equal(g.turn, (g.dealer + 1) % 4, "le joueur après le nouveau donneur parle en premier");
  assert.ok(g.hands.every((h) => h.length === 8));
  // Une donne normale efface l'indication.
  act(g, g.turn, { type: "bid", amount: 80, suit: "S" });
  for (let i = 0; i < 3; i++) act(g, g.turn, { type: "pass" });
  assert.equal(g.phase, "playing");
});
