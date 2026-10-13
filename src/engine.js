import { randomInt } from "node:crypto";
export const SUITS = ["S", "H", "D", "C"];
export const RANKS = ["7", "8", "9", "J", "Q", "K", "10", "A"];
export const DEFAULT_RULES = {
  target: 1000,
  turnSeconds: 30,
  reconnectSeconds: 90,
  counterWindowSeconds: 8,
  flyingCounter: true,
  scoring: "added",
  beloteRetained: true,
  beloteCountsContract: true,
  capotValue: 250,
  allPass: "redeal",
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
    return higher.length ? higher : trumps;
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
  Object.assign(g, {
    hands: [0, 1, 2, 3].map((i) => deck.slice(i * 8, i * 8 + 8)),
    phase: "bidding",
    turn: (g.dealer + 1) % 4,
    leader: (g.dealer + 1) % 4,
    contract: null,
    passes: 0,
    multiplier: 1,
    trick: [],
    tricks: [],
    points: [0, 0],
    belote: [0, 0],
    belotePlayed: [],
    counterDeadline: null,
    lastEvent: "Nouvelle donne",
    deal: g.deal + 1,
  });
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
export function scoreDeal(g) {
  const taker = team(g.contract.seat),
    def = 1 - taker,
    capot = g.contract.amount === 250;
  const made = capot
    ? g.tricks.every((t) => team(t.winner) === taker)
    : g.points[taker] + (g.rules.beloteCountsContract ? g.belote[taker] : 0) >=
      g.contract.amount;
  const score = [0, 0],
    base = capot ? g.rules.capotValue : g.contract.amount;
  if (made) {
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
      g.phase !== "bidding" ||
      !g.contract ||
      team(seat) === team(g.contract.seat) ||
      (!g.rules.flyingCounter && seat !== g.turn)
    )
      fail("Contre interdite");
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
    g.multiplier = 4;
    startPlay(g);
    g.lastEvent = "SURCONTRÉ !";
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
      g.contract = { seat, amount: a.amount, suit: a.suit };
      g.passes = 0;
      g.lastEvent = `Contrat ${a.amount === 250 ? "capot" : a.amount}`;
    } else g.passes++;
    g.turn = (g.turn + 1) % 4;
    if (g.contract && g.passes === 3) startPlay(g);
    else if (!g.contract && g.passes === 4) {
      if (g.rules.allPass === "rotate") g.dealer = (g.dealer + 1) % 4;
      deal(g);
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
  const { hands, beloteOwner, belotePlayed, ...publicState } = g;
  return {
    ...structuredClone(publicState),
    hand:
      Number.isInteger(seat) && seat >= 0 && seat < 4 ? [...hands[seat]] : [],
    handCounts: hands.map((h) => h.length),
    legal:
      g.phase === "playing" && seat === g.turn
        ? legalCards(hands[seat], g.trick, g.contract.suit, seat)
        : [],
  };
}
// Bots receive precisely the same redacted observation as human players.
export function botAction(v) {
  if (v.phase === "playing") return { type: "play", card: v.legal[0] };
  if (v.phase === "bidding") {
    if (!v.contract) {
      const best = SUITS.map((s) => ({
        s,
        n: v.hand
          .filter((c) => suit(c) === s)
          .reduce((n, c) => n + value(c, s), 0),
      })).sort((a, b) => b.n - a.n)[0];
      return { type: "bid", amount: 80, suit: best.s };
    }
    return { type: "pass" };
  }
  return null;
}
