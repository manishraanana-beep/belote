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
  assert.deepEqual([g.rules.target, g.rules.turnSeconds, g.rules.counterWindowSeconds, g.rules.capotValue, g.rules.reconnectSeconds, g.rules.scoring], [1000, 20, 8, 250, 90, "added"]);
});
test("temps écoulé : carte autorisée la plus forte", () => {
  assert.equal(strongestCard(["7H", "AH", "10H"], "S"), "AH");
  assert.equal(strongestCard(["AH", "7S"], "S"), "7S"); // l'atout l'emporte
  assert.equal(strongestCard(["AS", "9S", "JS"], "S"), "JS"); // valet d'atout
  assert.equal(strongestCard(["10D", "KD"], "S"), "10D");
});

test("robots : soutien du partenaire, pas de coupe sur le partenaire maître, pas de points donnés", () => {
  const bid = (seat, amount, suit) => ({ seat, type: "bid", amount, suit });
  const base = { phase: "bidding", turn: 3, auction: [], tricks: [], trick: [], legal: [] };
  // Ouverture à 100 : Valet + 9 d'atout (maître à l'atout).
  let a = botAction({ ...base, contract: null, hand: ["JH", "9H", "7H", "8H", "7C", "8C", "9D", "7D"] });
  assert.deepEqual(a, { type: "bid", amount: 100, suit: "H" });
  // Ouverture à 90 : le Valet sans le 9, cherche le 9.
  a = botAction({ ...base, contract: null, hand: ["JH", "AH", "7H", "8H", "7C", "8C", "9D", "7D"] });
  assert.deepEqual(a, { type: "bid", amount: 90, suit: "H" });
  // Ouverture à 80 : deux As.
  a = botAction({ ...base, contract: null, hand: ["AS", "AD", "7H", "8H", "7C", "8C", "9D", "QH"] });
  assert.deepEqual(a, { type: "bid", amount: 80, suit: "H" });
  // Main faible : passe.
  a = botAction({ ...base, contract: null, hand: ["7S", "8H", "9D", "7C", "8C", "QH", "KD", "7D"] });
  assert.equal(a.type, "pass");
  // Partenaire (siège 1) à 90 pique : le robot a le 9 recherché → +10.
  a = botAction({ ...base, contract: { seat: 1, amount: 90, suit: "S" }, auction: [bid(1, 90, "S")], hand: ["9S", "7H", "AH", "8D", "8C", "9C", "QH", "7D"] });
  assert.deepEqual(a, { type: "bid", amount: 100, suit: "S" });
  // Sur 90, trois petits atouts ne suffisent pas (pas de confusion avec la pièce recherchée).
  a = botAction({ ...base, contract: { seat: 1, amount: 90, suit: "S" }, auction: [bid(1, 90, "S")], hand: ["7S", "8S", "QS", "8D", "8C", "9C", "QH", "7D"] });
  assert.equal(a.type, "pass");
  // Sur 80, trois atouts → +10.
  a = botAction({ ...base, contract: { seat: 1, amount: 80, suit: "S" }, auction: [bid(1, 80, "S")], hand: ["7S", "8S", "QS", "8D", "8C", "9C", "QH", "7D"] });
  assert.deepEqual(a, { type: "bid", amount: 90, suit: "S" });
  // Sur 100, +10 par As extérieur.
  a = botAction({ ...base, contract: { seat: 1, amount: 100, suit: "S" }, auction: [bid(1, 100, "S")], hand: ["7S", "AH", "AD", "8D", "8C", "9C", "QH", "7D"] });
  assert.deepEqual(a, { type: "bid", amount: 120, suit: "S" });
  // Jeu : le partenaire (siège 1) a joué l'As de cœur maître, le robot (siège 3, dernier) n'a plus de cœur.
  const play = { phase: "playing", turn: 3, contract: { seat: 0, amount: 80, suit: "S" }, tricks: [], auction: [] };
  const trick = [{ seat: 0, card: "7H" }, { seat: 1, card: "AH" }, { seat: 2, card: "8H" }];
  a = botAction({ ...play, trick, hand: ["7S", "10C", "8D"], legal: ["7S", "10C", "8D"] });
  assert.equal(a.card, "10C", "il charge le pli du partenaire au lieu de couper");
  // Pli perdu face à un adversaire : la plus petite carte.
  const lost = [{ seat: 0, card: "AH" }, { seat: 1, card: "7H" }, { seat: 2, card: "8H" }];
  a = botAction({ ...play, contract: { seat: 1, amount: 80, suit: "S" }, trick: lost, hand: ["9H", "10H"], legal: ["9H", "10H"] });
  assert.equal(a.card, "9H");
  // Défausse sur le pli sûr du partenaire : l'As quand on garde le Dix de la couleur.
  a = botAction({ ...play, trick, hand: ["AC", "10C", "10D"], legal: ["AC", "10C", "10D"] });
  assert.equal(a.card, "AC");
  // Sans le Dix, le robot ne jette pas son As : il donne le Dix d'une autre couleur.
  a = botAction({ ...play, trick, hand: ["AC", "9C", "10D"], legal: ["AC", "9C", "10D"] });
  assert.equal(a.card, "10D");
  a = botAction({ ...play, trick, hand: ["AC", "8C", "7D"], legal: ["AC", "8C", "7D"] });
  assert.notEqual(a.card, "AC");
});

test("robots : rejouer atout pour le preneur, et plus d'atout quand les adversaires n'en ont plus", () => {
  const lead = (o) => botAction({ phase: "playing", turn: 2, trick: [], auction: [], tricks: [], contract: { seat: 0, amount: 90, suit: "S" }, ...o }).card;
  // Partenaire du preneur (siège 2), contrat à 90, il a la main à la 1re levée : il joue atout (le plus petit, sans être maître).
  assert.equal(lead({ hand: ["7S", "QS", "AH", "10H"], legal: ["7S", "QS", "AH", "10H"] }), "7S");
  // Avec le Valet (maître) : le Valet.
  assert.equal(lead({ hand: ["JS", "7S", "AH"], legal: ["JS", "7S", "AH"] }), "JS");
  // À la 2e levée aussi.
  const t1 = { cards: [{ seat: 1, card: "7D" }, { seat: 2, card: "AD" }, { seat: 3, card: "8D" }, { seat: 0, card: "9D" }], winner: 2 };
  assert.equal(lead({ tricks: [t1], hand: ["8S", "AH", "10H"], legal: ["8S", "AH", "10H"] }), "8S");
  // Contrat à 80 : pas d'obligation.
  assert.notEqual(lead({ contract: { seat: 0, amount: 80, suit: "S" }, hand: ["7S", "AH", "10H"], legal: ["7S", "AH", "10H"] }), "7S");
  // Les deux adversaires n'ont pas fourni atout : ni le preneur ni son partenaire ne rejouent atout.
  const trumpRound = { cards: [{ seat: 0, card: "AS" }, { seat: 1, card: "7H" }, { seat: 2, card: "8S" }, { seat: 3, card: "7C" }], winner: 0 };
  assert.equal(lead({ tricks: [trumpRound], hand: ["JS", "AH", "8D"], legal: ["JS", "AH", "8D"] }) === "JS", false);
  assert.notEqual(botAction({ phase: "playing", turn: 0, trick: [], auction: [], tricks: [trumpRound, t1], contract: { seat: 0, amount: 90, suit: "S" }, hand: ["JS", "9S", "KH", "8D"], legal: ["JS", "9S", "KH", "8D"] }).card.slice(-1), "S");
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

test("tout le monde passe : nouvelle donne, donneur suivant, partie en 1 000 points", () => {
  const g = newGame({});
  assert.equal(g.rules.target, 1000);
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
