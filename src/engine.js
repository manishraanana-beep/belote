import { randomInt } from "node:crypto";
export const SUITS = ["S", "H", "D", "C"];
export const RANKS = ["7", "8", "9", "J", "Q", "K", "10", "A"];
export const DEFAULT_RULES = {
  target: 1000,
  turnSeconds: 20,
  reconnectSeconds: 90,
  counterWindowSeconds: 8,
  flyingCounter: true,
  scoring: "added",
  beloteRetained: false,
  beloteCountsContract: true,
  capotValue: 250,
  allPass: "rotate",
};
const normal = ["7", "8", "9", "J", "Q", "K", "10", "A"],
  trump = ["7", "8", "Q", "K", "10", "A", "9", "J"];
const values = { 7: 0, 8: 0, 9: 0, J: 2, Q: 3, K: 4, 10: 10, A: 11 },
  tv = { ...values, 9: 14, J: 20 };
export const team = (s) => s % 2;
export const suit = (c) => c.slice(-1);
export const rank = (c) => c.slice(0, -1);
export const value = (c, t) => (suit(c) === t ? tv : values)[rank(c)];
export const strength = (c, t) =>
  (suit(c) === t ? trump : normal).indexOf(rank(c));
// Carte la plus forte parmi des cartes autorisées : un atout bat toute autre couleur ; à égalité
// de catégorie, l'ordre de force (atout : V 9 A 10 R D 8 7 ; sinon A 10 R D V 9 8 7), puis la valeur.
export function strongestCard(cards, t) {
  const score = (c) => (suit(c) === t ? 100 : 0) + strength(c, t) * 10 + value(c, t) / 100;
  return [...cards].sort((a, b) => score(b) - score(a))[0];
}
export function winner(trick, t) {
  let w = trick[0];
  for (const p of trick.slice(1)) {
    if (
      (suit(p.card) === suit(w.card) &&
        strength(p.card, t) > strength(w.card, t)) ||
      (suit(p.card) === t && suit(w.card) !== t)
    )
      w = p;
  }
  return w.seat;
}
export function legalCards(hand, trick, t, seat) {
  if (!trick.length) return [...hand];
  const led = suit(trick[0].card),
    following = hand.filter((c) => suit(c) === led),
    trumps = hand.filter((c) => suit(c) === t);
  const win = winner(trick, t),
    master = trick.find((p) => p.seat === win).card;
  if (following.length) {
    if (led === t) {
      const higher = following.filter(
        (c) => strength(c, t) > strength(master, t),
      );
      return higher.length ? higher : following;
    }
    return following;
  }
  if (team(win) === team(seat)) return [...hand];
  if (trumps.length) {
    const higher = trumps.filter(
      (c) => suit(master) !== t || strength(c, t) > strength(master, t),
    );
    // Un adversaire a déjà coupé plus haut que tous vos atouts : pas d'obligation de
    // « pisser » (sous-couper), vous jouez la carte de votre choix.
    return higher.length ? higher : [...hand];
  }
  return [...hand];
}
export function newGame(rules = {}) {
  const g = {
    rules: { ...DEFAULT_RULES, ...rules },
    scores: [0, 0],
    dealer: 3,
    deal: 0,
    history: [],
    version: 0,
  };
  deal(g);
  return g;
}
export function deal(g) {
  const deck = SUITS.flatMap((s) => RANKS.map((r) => r + s));
  for (let i = 31; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const classic = g.rules?.variant === "classique";
  Object.assign(g, {
    // Belote classique : 5 cartes chacun, une carte retournée, le reste distribué après la prise.
    hands: [0, 1, 2, 3].map((i) => (classic ? deck.slice(i * 5, i * 5 + 5) : deck.slice(i * 8, i * 8 + 8))),
    stock: classic ? deck.slice(21) : null,
    turnUp: classic ? deck[20] : null,
    round: 1,
    phase: "bidding",
    turn: (g.dealer + 1) % 4,
    leader: (g.dealer + 1) % 4,
    contract: null,
    passes: 0,
    auction: [],
    multiplier: 1,
    trick: [],
    tricks: [],
    points: [0, 0],
    belote: [0, 0],
    belotePlayed: [],
    counterDeadline: null,
    lastEvent: "Nouvelle donne",
    allPassed: false,
    deal: g.deal + 1,
  });
  if (classic) {
    g.beloteOwner = -1;
    g.version++;
    return;
  }
  g.beloteOwner = g.hands.findIndex((h) =>
    SUITS.some((s) => h.includes("K" + s) && h.includes("Q" + s)),
  );
  g.version++;
}
function fail(message) {
  throw new Error(message);
}
function startPlay(g) {
  g.phase = "playing";
  g.turn = g.leader;
  g.counterDeadline = null;
  g.lastEvent = "À vous de jouer";
}
// Belote classique : le preneur doit faire plus de points que la défense (belote comprise) ;
// sinon il est « dedans » et la défense marque 162. Capot : 250. Chacun marque ses points.
function scoreClassic(g) {
  const taker = team(g.contract.seat),
    def = 1 - taker;
  const capotT = g.tricks.every((t) => team(t.winner) === taker),
    capotD = g.tricks.every((t) => team(t.winner) === def);
  const tot = (i) => g.points[i] + g.belote[i];
  const made = tot(taker) > tot(def);
  const score = [0, 0];
  if (capotT) {
    score[taker] = 250 + g.belote[taker];
    score[def] = g.belote[def];
  } else if (made) {
    score[taker] = tot(taker);
    score[def] = tot(def);
  } else {
    score[def] = (capotD ? 250 : 162) + g.belote[def];
    score[taker] = g.rules.beloteRetained ? g.belote[taker] : 0;
  }
  return { made, capot: capotT, score, points: [...g.points], belote: [...g.belote], contract: { ...g.contract }, multiplier: 1, tricks: structuredClone(g.tricks), deal: g.deal };
}
export function scoreDeal(g) {
  if (g.rules.variant === "classique") return scoreClassic(g);
  const taker = team(g.contract.seat),
    def = 1 - taker,
    capot = g.contract.amount === 250;
  const made = capot
    ? g.tricks.every((t) => team(t.winner) === taker)
    : g.points[taker] + (g.rules.beloteCountsContract ? g.belote[taker] : 0) >=
      g.contract.amount;
  const score = [0, 0],
    base = capot ? g.rules.capotValue : g.contract.amount;
  // Capot réalisé sans l'avoir annoncé : annonce + 250 points (les points des plis ne s'ajoutent pas).
  const unannouncedCapot = !capot && g.tricks.length === 8 && g.tricks.every((t) => team(t.winner) === taker);
  if (made && unannouncedCapot) {
    score[taker] = (g.contract.amount + 250) * g.multiplier + g.belote[taker];
    score[def] = g.belote[def];
  } else if (made) {
    score[taker] =
      (g.rules.scoring === "contract" ? base : g.points[taker] + base) *
        g.multiplier +
      g.belote[taker];
    score[def] = g.points[def] + g.belote[def];
  } else {
    score[def] =
      (g.rules.scoring === "contract" ? base : 162 + base) * g.multiplier +
      g.belote[def];
    score[taker] = g.rules.beloteRetained ? g.belote[taker] : 0;
  }
  return {
    made,
    capot: capot || unannouncedCapot,
    score,
    points: [...g.points],
    belote: [...g.belote],
    contract: { ...g.contract },
    multiplier: g.multiplier,
    tricks: structuredClone(g.tricks),
    deal: g.deal,
  };
}
export function act(g, seat, a, now = Date.now()) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) fail("Place invalide");
  if (a.type === "counter") {
    if (
      g.rules.variant === "classique" ||
      g.phase !== "bidding" ||
      !g.contract ||
      team(seat) === team(g.contract.seat) ||
      (!g.rules.flyingCounter && seat !== g.turn)
    )
      fail("Contre interdite");
    (g.auction ??= []).push({ seat, type: "counter", at: now });
    g.multiplier = 2;
    g.phase = "counter";
    g.counterDeadline = now + g.rules.counterWindowSeconds * 1000;
    g.lastEvent = "CONTRÉ !";
  } else if (a.type === "surcounter") {
    if (
      g.phase !== "counter" ||
      now >= g.counterDeadline ||
      team(seat) !== team(g.contract.seat)
    )
      fail("Surcontre interdite");
    (g.auction ??= []).push({ seat, type: "surcounter", at: now });
    g.multiplier = 4;
    startPlay(g);
    g.lastEvent = "SURCONTRÉ !";
  } else if (g.rules.variant === "classique" && (a.type === "take" || (a.type === "pass" && g.phase === "bidding"))) {
    if (g.phase !== "bidding" || seat !== g.turn) fail("Ce n’est pas votre tour");
    const up = suit(g.turnUp);
    if (a.type === "take") {
      const s = g.round === 1 ? up : a.suit;
      if (!SUITS.includes(s) || (g.round === 2 && s === up)) fail("Couleur invalide");
      g.auction.push({ seat, type: "bid", amount: 0, suit: s, at: now });
      g.contract = { seat, amount: 0, suit: s };
      // Le preneur reçoit la carte retournée et 2 cartes, les autres 3 cartes.
      g.hands[seat].push(g.turnUp);
      for (let k = 1; k <= 4; k++) {
        const p = (g.dealer + k) % 4;
        g.hands[p].push(...g.stock.splice(0, p === seat ? 2 : 3));
      }
      g.turnUp = null;
      g.stock = null;
      g.beloteOwner = g.hands.findIndex((h) => h.includes("K" + s) && h.includes("Q" + s));
      g.lastEvent = `${g.round === 1 ? "Je prends" : "Je prends à " + s}`;
      startPlay(g);
    } else {
      g.auction.push({ seat, type: "pass", at: now });
      g.passes++;
      g.turn = (g.turn + 1) % 4;
      if (g.passes === 4 && g.round === 1) {
        g.round = 2;
        g.passes = 0;
        g.lastEvent = "Deuxième tour : choisissez une autre couleur";
      } else if (g.passes === 4) {
        g.dealer = (g.dealer + 1) % 4;
        deal(g);
        g.allPassed = true;
        g.lastEvent = "Tout le monde a passé · nouvelle donne";
      }
    }
  } else if (a.type === "pass" || a.type === "bid") {
    if (g.phase !== "bidding" || seat !== g.turn)
      fail("Ce n’est pas votre tour d’enchérir");
    if (a.type === "bid") {
      if (
        !SUITS.includes(a.suit) ||
        ![80, 90, 100, 110, 120, 130, 140, 150, 160, 250].includes(a.amount) ||
        (g.contract && a.amount <= g.contract.amount)
      )
        fail("Enchère invalide");
      (g.auction ??= []).push({
        seat,
        type: "bid",
        amount: a.amount,
        suit: a.suit,
        at: now,
      });
      g.contract = { seat, amount: a.amount, suit: a.suit };
      g.passes = 0;
      g.lastEvent = `Contrat ${a.amount === 250 ? "capot" : a.amount}`;
    } else {
      (g.auction ??= []).push({ seat, type: "pass", at: now });
      g.passes++;
    }
    g.turn = (g.turn + 1) % 4;
    if (g.contract && g.passes === 3) startPlay(g);
    else if (!g.contract && g.passes === 4) {
      // Tout le monde a passé : on redistribue, le donneur suivant prend la main.
      if (g.rules.allPass === "rotate") g.dealer = (g.dealer + 1) % 4;
      deal(g);
      g.allPassed = true;
      g.lastEvent = "Tout le monde a passé · nouvelle donne";
    }
  } else if (a.type === "play") {
    if (g.phase !== "playing" || seat !== g.turn)
      fail("Ce n’est pas votre tour");
    if (
      !legalCards(g.hands[seat], g.trick, g.contract.suit, seat).includes(
        a.card,
      )
    )
      fail("Carte interdite");
    g.hands[seat].splice(g.hands[seat].indexOf(a.card), 1);
    g.trick.push({ seat, card: a.card });
    if (suit(a.card) === g.contract.suit && ["K", "Q"].includes(rank(a.card))) {
      const other = (rank(a.card) === "K" ? "Q" : "K") + g.contract.suit;
      if (
        g.hands[seat].includes(other) ||
        g.belotePlayed.some((p) => p.seat === seat && p.card === other)
      ) {
        g.belotePlayed.push({ seat, card: a.card });
        g.lastEvent =
          g.belotePlayed.filter((p) => p.seat === seat).length === 2
            ? "Rebelote !"
            : "Belote !";
        if (g.belotePlayed.filter((p) => p.seat === seat).length === 2)
          g.belote[team(seat)] = 20;
      }
    }
    if (g.trick.length === 4) {
      const w = winner(g.trick, g.contract.suit),
        p =
          g.trick.reduce((sum, c) => sum + value(c.card, g.contract.suit), 0) +
          (g.tricks.length === 7 ? 10 : 0);
      g.points[team(w)] += p;
      g.tricks.push({ cards: [...g.trick], winner: w, points: p });
      g.trick = [];
      g.turn = w;
      if (g.tricks.length === 8) {
        const result = scoreDeal(g);
        g.history.push(result);
        g.scores = g.scores.map((s, i) => s + result.score[i]);
        g.phase =
          Math.max(...g.scores) >= g.rules.target && g.scores[0] !== g.scores[1]
            ? "finished"
            : "summary";
        g.lastEvent = result.made ? "Contrat réussi" : "Contrat chuté";
      }
    } else g.turn = (g.turn + 1) % 4;
  } else fail("Action inconnue");
  g.version++;
  return g;
}
export function expireCounter(g, now = Date.now()) {
  if (g.phase === "counter" && now >= g.counterDeadline) {
    startPlay(g);
    g.version++;
    return true;
  }
  return false;
}
export function nextDeal(g) {
  if (g.phase !== "summary") fail("Donne encore en cours");
  g.dealer = (g.dealer + 1) % 4;
  deal(g);
}
export function view(g, seat) {
  const { hands, beloteOwner, belotePlayed, stock, ...publicState } = g;
  return {
    ...structuredClone(publicState),
    // Belote / rebelote déjà jouées (cartes visibles de tous) : sert aux annonces.
    beloteCalls: belotePlayed.map((p) => ({ ...p })),
    hand:
      Number.isInteger(seat) && seat >= 0 && seat < 4 ? [...hands[seat]] : [],
    handCounts: hands.map((h) => h.length),
    legal:
      g.phase === "playing" && seat === g.turn
        ? legalCards(hands[seat], g.trick, g.contract.suit, seat)
        : [],
  };
}
// Robots : ils reçoivent exactement la même observation qu'un joueur humain (leur main et ce qui
// est public), jamais les cartes cachées. Stratégie de joueurs de contrée : annonces fondées sur
// Valet/9 d'atout et la longueur, soutien du partenaire (+10 avec le Valet ou 3 atouts, +10 par As
// extérieur), contre raisonné, jeu de la carte (faire tomber les atouts, protéger ses As, charger
// le pli du partenaire maître, ne pas couper son partenaire, ne pas donner de points).
const AMOUNTS = [80, 90, 100, 110, 120, 130, 140, 150, 160];
const roundBid = (n) => AMOUNTS.filter((a) => a <= n).at(-1) ?? null;
function handFor(hand, s) {
  const tr = hand.filter((c) => suit(c) === s);
  const has = (r) => tr.includes(r + s);
  const sideAces = hand.filter((c) => suit(c) !== s && rank(c) === "A").length;
  const sideTens = hand.filter((c) => suit(c) !== s && rank(c) === "10" && hand.includes("A" + suit(c))).length;
  return { n: tr.length, J: has("J"), nine: has("9"), A: has("A"), ten: has("10"), sideAces, sideTens, belote: has("K") && has("Q") };
}
// Valeur d'annonce estimée d'une main pour un atout donné (null : ne pas prendre).
function ownBid(hand, s) {
  const h = handFor(hand, s);
  let base = null;
  if (h.J && h.nine && h.n >= 3) base = 80 + (h.n - 3) * 10; // Valet + 9 : excellente base
  else if (h.J && h.A && h.n >= 3) base = 80 + Math.max(0, h.n - 4) * 10; // Valet + As, prudence sans le 9
  else if (h.J && h.n >= 4) base = 80 + (h.n - 4) * 10;
  else if (h.nine && h.A && h.n >= 4) base = 80; // sans le Valet, il faut de la longueur
  if (base === null) return null;
  base += h.sideAces * 10 + h.sideTens * 5 + (h.belote ? 10 : 0);
  return Math.min(160, base);
}
// Système d'annonces de la maison (ouvertures) :
// 100 = maître à l'atout (Valet + 9), demande les As extérieurs ;
// 90 = cherche le Valet ou le 9 d'atout (il en a un des deux) ;
// 80 = deux As.
function opening(hand) {
  const aces = hand.filter((c) => rank(c) === "A").length;
  const pick = (test) => SUITS.map((s) => ({ s, h: handFor(hand, s) })).filter((x) => test(x.h)).sort((a, b) => b.h.n - a.h.n)[0];
  const top = pick((h) => h.J && h.nine && (h.n >= 4 || (h.n >= 3 && h.A)));
  if (top) return { amount: 100, suit: top.s };
  const seek = pick((h) => h.J !== h.nine && h.n >= 3 && (h.n >= 4 || h.A));
  if (seek) return { amount: 90, suit: seek.s };
  if (aces >= 2) {
    // Couleur la plus longue (puis la plus garnie) pour l'annonce des deux As.
    const best = SUITS.map((s) => ({ s, h: handFor(hand, s) })).sort((a, b) => b.h.n - a.h.n || +b.h.J - +a.h.J || +b.h.nine - +a.h.nine)[0];
    return { amount: 80, suit: best.s };
  }
  return null;
}
// Réponse au partenaire qui vient d'ouvrir, selon le système.
function response(hand, open) {
  const h = handFor(hand, open.suit);
  if (open.amount === 90) {
    // +10 avec la pièce recherchée (Valet ou 9) ou avec 3 atouts (pas les deux), +10 de plus avec un As.
    let plus = h.J || h.nine || h.n >= 3 ? 10 : 0;
    if (plus && hand.some((c) => rank(c) === "A")) plus += 10;
    return plus;
  }
  if (open.amount === 100) return Math.min(3, h.sideAces) * 10; // +10 par As extérieur
  if (open.amount === 80) return h.n >= 3 ? 10 : 0; // trois atouts
  return 0;
}
function botBid(v, me) {
  const partner = (me + 2) % 4,
    c = v.contract,
    auction = v.auction ?? [];
  const mine = SUITS.map((s) => ({ s, amount: ownBid(v.hand, s) })).filter((x) => x.amount).sort((a, b) => b.amount - a.amount)[0];
  if (!c) {
    const o = opening(v.hand);
    return o ? { type: "bid", ...o } : { type: "pass" };
  }
  if (c.seat === partner) {
    // Une seule réponse, à l'ouverture du partenaire (sa première annonce).
    const partnerBids = auction.filter((x) => x.type === "bid" && x.seat === partner).length;
    const iBid = auction.some((x) => x.type === "bid" && x.seat === me);
    if (partnerBids > 1 || iBid) return { type: "pass" };
    // Annonce « collée » juste au-dessus de l'adversaire (80 → 90, 90 → 100…) : le partenaire
    // cherche le Valet ou le 9, comme une ouverture à 90. Un saut (80 → 100) garde son sens : maître.
    const bids = auction.filter((x) => x.type === "bid");
    const at = bids.findIndex((x) => x.seat === partner);
    const before = at > 0 ? bids[at - 1] : null;
    const glued = before && team(before.seat) !== team(me) && c.amount === before.amount + 10;
    const plus = response(v.hand, glued ? { ...c, amount: 90 } : c);
    const target = c.amount + plus;
    if (plus && target <= 160) return { type: "bid", amount: target, suit: c.suit };
    return { type: "pass" };
  }
  if (team(c.seat) === team(me)) return { type: "pass" }; // notre propre contrat
  // Contrat adverse : 80, 90 et 100 gardent le sens du système (le partenaire répond selon le système).
  const o = opening(v.hand);
  if (o && o.amount > c.amount && o.suit !== c.suit) return { type: "bid", ...o };
  // Au-delà de 100 : surenchérir seulement avec une vraie main, sinon envisager le contre.
  if (c.amount >= 100 && mine && mine.amount >= c.amount + 10) {
    const amount = roundBid(Math.min(mine.amount, c.amount + 20));
    if (amount && amount > c.amount) return { type: "bid", amount, suit: mine.s };
  }
  const h = handFor(v.hand, c.suit);
  const strongTrump = [h.J, h.nine, h.A].filter(Boolean).length;
  const counter = c.amount <= 160 && ((c.amount >= 100 && strongTrump >= 2 && h.n >= 2) || (c.amount >= 120 && strongTrump >= 1 && h.sideAces >= 2));
  if (counter && !(v.auction ?? []).some((a) => a.type === "counter")) return { type: "counter" };
  return { type: "pass" };
}
function botPlay(v, me) {
  const t = v.contract.suit,
    legal = v.legal,
    trick = v.trick,
    partner = (me + 2) % 4;
  if (legal.length === 1) return legal[0];
  const played = new Set([...v.tricks.flatMap((x) => x.cards.map((p) => p.card)), ...trick.map((p) => p.card)]);
  const order = (s) => (s === t ? ["7", "8", "Q", "K", "10", "A", "9", "J"] : ["7", "8", "9", "J", "Q", "K", "10", "A"]);
  const unseenHigher = (c) => {
    const s = suit(c),
      o = order(s);
    return o.slice(o.indexOf(rank(c)) + 1).some((r) => !played.has(r + s) && !v.hand.includes(r + s));
  };
  const master = (c) => !unseenHigher(c);
  const trumpsOut = order(t).filter((r) => !played.has(r + t) && !v.hand.includes(r + t)).length;
  const cheap = (c) => value(c, t) + strength(c, t) * 0.1 + (suit(c) === t ? 30 : 0);
  const byCheap = [...legal].sort((a, b) => cheap(a) - cheap(b));
  const takers = team(v.contract.seat) === team(me);
  // Appels indirects : défausser une couleur appelle l'As de la couleur sœur (même teinte :
  // carreau ↔ cœur, pique ↔ trèfle), jamais vers l'atout.
  const SISTER = { S: "C", C: "S", H: "D", D: "H" };
  const calledBy = (seat) => {
    const out = new Set();
    for (const tr of [...v.tricks, { cards: trick }]) {
      const lead = tr.cards?.[0] && suit(tr.cards[0].card);
      for (const p of tr.cards ?? [])
        if (p.seat === seat && suit(p.card) !== lead && suit(p.card) !== t && SISTER[suit(p.card)] !== t) out.add(SISTER[suit(p.card)]);
    }
    return out;
  };
  // Carte d'appel à défausser quand on ne fournit pas : petite carte de la couleur sœur d'un As que l'on tient.
  const signal = () => {
    const lead = trick[0] && suit(trick[0].card);
    if (!lead || legal.some((c) => suit(c) === lead)) return null;
    for (const x of SUITS) {
      const sis = SISTER[x];
      if (x === t || sis === t || !v.hand.includes("A" + x)) continue;
      const low = legal.filter((c) => suit(c) === sis && value(c, t) < 10 && !master(c)).sort((a, b) => cheap(a) - cheap(b));
      if (low.length) return low[0];
    }
    return null;
  };
  if (!trick.length) {
    const myTrumps = legal.filter((c) => suit(c) === t);
    // Un adversaire qui n'a pas fourni sur une entame d'atout n'en a plus.
    const voidTrump = new Set();
    for (const tr of [...v.tricks, { cards: trick }])
      if (tr.cards?.length && suit(tr.cards[0].card) === t) for (const p of tr.cards.slice(1)) if (suit(p.card) !== t) voidTrump.add(p.seat);
    const opps = [(me + 1) % 4, (me + 3) % 4];
    const oppsHaveTrump = trumpsOut > 0 && opps.some((s) => !voidTrump.has(s));
    const takerSeat = v.contract.seat;
    // Partenaire du preneur, contrat à 90 ou plus : il rejoue atout dès qu'il a la main
    // sur la 1re ou la 2e levée (pour aider le preneur à faire tomber les atouts adverses).
    if (takers && me !== takerSeat && v.contract.amount >= 90 && v.tricks.length <= 1 && myTrumps.length && oppsHaveTrump)
      return myTrumps.some(master) ? myTrumps.filter(master).sort((a, b) => strength(b, t) - strength(a, t))[0] : [...myTrumps].sort((a, b) => strength(a, t) - strength(b, t))[0];
    // Preneur maître à l'atout : faire tomber les atouts adverses, tant qu'il en reste chez eux.
    if (takers && me === takerSeat && oppsHaveTrump && myTrumps.some(master)) return myTrumps.filter(master).sort((a, b) => strength(b, t) - strength(a, t))[0];
    // Les adversaires n'ont plus d'atout : on ne rejoue pas atout (on garde ses atouts pour couper).
    const pool = !oppsHaveTrump && legal.some((c) => suit(c) !== t) ? legal.filter((c) => suit(c) !== t) : legal;
    // Cartes maîtresses à côté de l'atout, tant que la couleur n'a pas trop circulé (risque de coupe).
    const sideMasters = pool.filter((c) => suit(c) !== t && master(c) && value(c, t) >= 10 && [...played].filter((x) => suit(x) === suit(c)).length <= 3);
    if (sideMasters.length) return sideMasters.sort((a, b) => value(b, t) - value(a, t))[0];
    // Le partenaire a appelé une couleur (appel indirect) : on la joue pour atteindre son As.
    const calls = calledBy(partner);
    const toCall = byCheap.filter((c) => pool.includes(c) && suit(c) !== t && calls.has(suit(c)) && !played.has("A" + suit(c)) && !v.hand.includes("A" + suit(c)));
    if (toCall.length) return toCall[0];
    // Sinon une petite carte d'une couleur longue, en gardant ses atouts.
    const side = byCheap.filter((c) => suit(c) !== t);
    return side[0] ?? byCheap.filter((c) => pool.includes(c))[0] ?? byCheap[0];
  }
  const w = winner(trick, t),
    winCard = trick.find((p) => p.seat === w).card,
    last = trick.length === 3;
  const beats = (c) => winner([...trick, { seat: me, card: c }], t) === me;
  if (team(w) === team(me)) {
    // Partenaire maître du pli : ne pas le couper ; le charger s'il est sûr de le garder.
    const safe = last || (master(winCard) && (suit(winCard) === t || trumpsOut === 0 || suit(trick[0].card) === suit(winCard)));
    const nonTrump = legal.filter((c) => suit(c) !== t || suit(trick[0].card) === t);
    const pool = nonTrump.length ? nonTrump : legal;
    // Partenaire qui entame atout (le Valet…) : on fournit le plus petit atout et on garde ses
    // atouts maîtres (le 9 reste maître derrière le Valet du preneur).
    if (suit(trick[0].card) === t) {
      const tr = legal.filter((c) => suit(c) === t);
      if (tr.length) return tr.sort((a, b) => strength(a, t) - strength(b, t))[0];
    }
    const call = signal();
    if (safe) {
      // Défausse sur le pli sûr du partenaire : l'As si l'on garde le Dix (qui devient maître),
      // le Dix si l'on n'a pas l'As. Jamais un As sans son Dix (sauf s'il ne reste rien d'autre).
      const lead = suit(trick[0].card);
      const load = (c) => {
        if (suit(c) === lead || suit(c) === t) return value(c, t);
        if (rank(c) === "A") return v.hand.includes("10" + suit(c)) ? 30 : -50; // As jeté = Dix gardé ; sinon on garde l'As
        // Une carte maîtresse fera son propre pli plus tard : on la garde.
        if (master(c)) return value(c, t) - 25;
        if (rank(c) === "10") return v.hand.includes("A" + suit(c)) ? 5 : 20;
        return value(c, t);
      };
      const best = [...pool].sort((a, b) => load(b) - load(a) || cheap(a) - cheap(b))[0];
      return call && load(best) < 10 ? call : best;
    }
    return call ?? [...pool].sort((a, b) => cheap(a) - cheap(b))[0];
  }
  const winners = legal.filter(beats).sort((a, b) => cheap(a) - cheap(b));
  if (winners.length) {
    if (last) return winners[0]; // gagner au plus juste
    const sure = winners.filter(master);
    const points = trick.reduce((n, p) => n + value(p.card, t), 0);
    // Une coupe peut être décisive : on prend les plis qui valent la peine.
    if (sure.length && (points >= 10 || suit(sure[0]) !== t)) return sure.sort((a, b) => cheap(a) - cheap(b))[0];
    if (points >= 10 || suit(winners[0]) !== t) return winners[0];
  }
  // Pli perdu : ne pas donner de points aux adversaires (et en profiter pour un appel indirect).
  return signal() ?? byCheap[0];
}
// Belote classique : prendre avec une bonne main dans la couleur (5 cartes + la carte retournée).
function classicStrength(hand, s, withUp) {
  const h = withUp ? [...hand, withUp] : hand;
  const tr = h.filter((c) => suit(c) === s);
  const has = (r) => tr.includes(r + s);
  let n = (has("J") ? 4 : 0) + (has("9") ? 3 : 0) + (has("A") ? 1.5 : 0) + (has("10") ? 1 : 0) + tr.length * 1.2;
  n += h.filter((c) => suit(c) !== s && rank(c) === "A").length * 1.2;
  return n;
}
function botClassic(v) {
  const up = suit(v.turnUp);
  if (v.round === 1) return classicStrength(v.hand, up, v.turnUp) >= 8.5 ? { type: "take" } : { type: "pass" };
  const best = SUITS.filter((s) => s !== up)
    .map((s) => ({ s, n: classicStrength(v.hand, s, null) + 1.5 })) // 3 cartes encore à recevoir
    .sort((a, b) => b.n - a.n)[0];
  return best.n >= 8.5 ? { type: "take", suit: best.s } : { type: "pass" };
}
export function botAction(v) {
  const me = v.turn;
  if (v.phase === "playing") return { type: "play", card: botPlay(v, me) };
  if (v.phase === "bidding" && v.rules?.variant === "classique") return botClassic(v);
  if (v.phase === "bidding") return botBid(v, me);
  return null;
}
