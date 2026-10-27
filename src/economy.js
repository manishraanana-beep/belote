// Crédits virtuels : portefeuille, journal, réservations et règlement des parties.
// Les montants sont stockés en DEMI-CRÉDITS entiers (1 crédit = 2 unités) pour partager
// exactement une somme impaire. Les crédits ne sont ni retirables, ni transférables,
// ni convertibles en argent réel.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const U = 2; // unités par crédit
export const STAKES = [100, 200, 500, 1000, 2500, 10000];
// Rubicon : la victoire écrasante rapporte le double de la mise.
export const RUBICON = 1; // perte limitée à la mise, même en Rubicon
export const toUnits = (credits) => Math.round(credits * U);
export const toCredits = (units) => units / U;

export function economyConfig(env = process.env) {
  const num = (k, d) => (env[k] !== undefined && env[k] !== "" ? Number(env[k]) : d);
  let packs = [
    { id: "pack-1000", credits: 1000, price: "0,99 €", priceCents: 99 },
    { id: "pack-3000", credits: 3000, price: "2,49 €", priceCents: 249, bonus: "+20 %" },
    { id: "pack-8000", credits: 8000, price: "4,99 €", priceCents: 499, bonus: "+60 %" },
    { id: "pack-20000", credits: 20000, price: "9,99 €", priceCents: 999, bonus: "Meilleure offre" },
  ];
  try {
    if (env.BELOTE_PACKS) packs = JSON.parse(env.BELOTE_PACKS);
  } catch {
    console.error("BELOTE_PACKS illisible : packs par défaut");
  }
  const production = env.NODE_ENV === "production" || !!env.RAILWAY_ENVIRONMENT;
  return {
    signupBonus: num("BELOTE_SIGNUP_BONUS", 2000),
    // Droit de table : % de la mise payé à l'entrée par chaque joueur, retiré de la circulation.
    tableFeePct: num("BELOTE_TABLE_FEE_PCT", 10),
    // Bonus de connexion : montant par défaut, modifiable depuis l'administration.
    loginBonus: num("BELOTE_LOGIN_BONUS", 200),
    dayStartUtc: num("BELOTE_DAY_START_UTC", 3), // heure commune de renouvellement
    packs,
    // Les achats restent désactivables globalement.
    purchases: env.BELOTE_PURCHASES === "on",
    stripe: !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
    apple: !!env.APPLE_IAP_BUNDLE_ID,
    google: !!(env.GOOGLE_PLAY_PACKAGE && env.GOOGLE_PLAY_SERVICE_ACCOUNT),
    // Fournisseur de test : jamais disponible en production.
    testShop: env.BELOTE_TEST_SHOP === "on" && !production,
  };
}

// Jour de jeu commun : change chaque jour à dayStartUtc heures UTC.
export function dayId(now = Date.now(), startUtc = 3) {
  return new Date(now - startUtc * 3600_000).toISOString().slice(0, 10);
}
export function nextReset(now = Date.now(), startUtc = 3) {
  const d = new Date(now - startUtc * 3600_000);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime() + startUtc * 3600_000;
}

export const LOGIN_PERIOD = 24 * 3600_000;
// Roue du jour : 8 cases (multiples du bonus de base) et leurs chances sur 100.
export const WHEEL = [
  { x: 0.5, w: 20 },
  { x: 1, w: 20 },
  { x: 0.75, w: 18 },
  { x: 2, w: 10 },
  { x: 1, w: 14 },
  { x: 3, w: 6 },
  { x: 1.5, w: 11 },
  { x: 10, w: 1 },
];
// Série de jours : multiplicateur selon le nombre de jours d'affilée (plafonné au 7e jour).
export const STREAK = [1, 1.25, 1.5, 2, 2.5, 3, 4];
const STREAK_GRACE = 48 * 3600_000; // revenir dans les 48 h garde la série

export function createEconomy(db, config = economyConfig()) {
  db.ledger ??= [];
  db.ledgerKeys ??= {};
  db.settings ??= {};
  const loginAmount = () => db.settings.loginBonus ?? config.loginBonus;
  const wallet = (p) => (p.wallet ??= { balance: 0, reserved: 0 });
  const available = (p) => wallet(p).balance - wallet(p).reserved;
  // Écriture unique au journal : la clé empêche toute double attribution.
  function post(p, key, type, amount, meta = {}) {
    if (db.ledgerKeys[key]) return null;
    const w = wallet(p);
    if (w.balance + amount < 0) throw Error("Solde insuffisant");
    w.balance += amount;
    const entry = {
      id: randomBytes(9).toString("base64url"),
      key,
      pid: p.id,
      type,
      amount,
      balance: w.balance,
      at: Date.now(),
      ...meta,
    };
    db.ledger.push(entry);
    db.ledgerKeys[key] = entry.id;
    return entry;
  }
  function history(p, limit = 60) {
    const out = [];
    for (let i = db.ledger.length - 1; i >= 0 && out.length < limit; i--)
      if (db.ledger[i].pid === p.id) out.push(db.ledger[i]);
    return out;
  }
  // Droit de table en crédits pour une mise donnée (0 en partie gratuite).
  const tableFee = (stakeCredits) => (stakeCredits > 0 ? Math.round((stakeCredits * (config.tableFeePct ?? 0)) / 100) : 0);
  return {
    config,
    tableFee,
    wallet,
    available,
    history,
    post,
    view(p) {
      const w = wallet(p);
      return {
        balance: w.balance,
        reserved: w.reserved,
        available: w.balance - w.reserved,
        loginBonus: p.accountId
          ? {
              amount: loginAmount(),
              next: p.loginBonusAt ? p.loginBonusAt + LOGIN_PERIOD : Date.now(),
              // Série en cours (0 si elle est perdue) et multiplicateur du prochain tour.
              streak: p.loginBonusAt && Date.now() - p.loginBonusAt < STREAK_GRACE ? (p.loginStreak ?? 1) : 0,
              nextMult: STREAK[Math.min(p.loginBonusAt && Date.now() - p.loginBonusAt < STREAK_GRACE ? (p.loginStreak ?? 1) + 1 : 1, STREAK.length) - 1],
            }
          : null,
      };
    },
    signupBonus(p, account) {
      // Une seule fois par adresse : supprimer puis recréer un compte ne redonne rien.
      const k = `signup:${account.emailHash ?? account.id}`;
      return post(p, k, "signup", toUnits(config.signupBonus), { label: "Bienvenue à la Maison" });
    },
    loginAmount,
    // Bonus de connexion : un par compte et par période de 24 h (heure du serveur), sans cumul
    // des jours d'absence. Vérification et écriture sont synchrones : deux connexions simultanées
    // ne peuvent pas l'obtenir deux fois. Seul le solde augmente, jamais les crédits engagés.
    // Roue du jour (remplace le bonus de connexion) : un tour par compte et par période de 24 h.
    // Le serveur tire la case ; le gain = bonus de base × case × multiplicateur de série.
    loginBonus(p, now = Date.now(), rnd = Math.random) {
      if (!p.accountId || !(loginAmount() > 0)) return null;
      if (p.loginBonusAt && now - p.loginBonusAt < LOGIN_PERIOD) return null;
      const streak = p.loginBonusAt && now - p.loginBonusAt < STREAK_GRACE ? Math.min((p.loginStreak ?? 1) + 1, 99) : 1;
      let r = rnd() * WHEEL.reduce((a, c) => a + c.w, 0),
        segment = 0;
      while (r >= WHEEL[segment].w && segment < WHEEL.length - 1) r -= WHEEL[segment++].w;
      const mult = STREAK[Math.min(streak, STREAK.length) - 1];
      const credits = Math.max(1, Math.round(loginAmount() * WHEEL[segment].x * mult));
      const seq = (p.loginBonusSeq ?? 0) + 1;
      const e = post(p, `login:${p.accountId}:${seq}`, "login", toUnits(credits), { label: `Roue du jour · série ${streak} j` });
      if (!e) return null;
      p.loginBonusAt = now;
      p.loginBonusSeq = seq;
      p.loginStreak = streak;
      return { ...e, segment, streak, mult };
    },
    // Réservation au lancement : min(disponible, 3 × mise), figée pour toute la partie.
    // house : les places sans joueur (robots) sont tenues par la Maison, qui engage le maximum.
    reserve(t, players, { house = false } = {}) {
      const stake = toUnits(t.stake);
      const fee = toUnits(tableFee(t.stake));
      const stakes = [];
      for (let seat = 0; seat < 4; seat++) {
        const p = players[seat];
        if (!p && house) continue;
        if (!p) throw Error("Les parties avec crédits se jouent à quatre joueurs");
        if (available(p) < stake + fee) throw Error(`${p.name} n’a pas assez de crédits disponibles`);
      }
      for (let seat = 0; seat < 4; seat++) {
        const p = players[seat];
        if (!p) {
          stakes.push({ seat, pid: null, name: "Maison", engaged: RUBICON * stake, house: true });
          continue;
        }
        if (fee) post(p, `fee:${t.gameId}:${p.id}`, "fee", -fee, { gameId: t.gameId, label: "Droit de table" });
        const engaged = Math.min(available(p), RUBICON * stake);
        wallet(p).reserved += engaged;
        stakes.push({ seat, pid: p.id, name: p.name, engaged, fee });
      }
      return { gameId: t.gameId, stake, fee, seats: stakes, settled: false };
    },
    // Annulation technique : réservations libérées, ni gain ni perte.
    release(players, money, reason = "Partie annulée") {
      if (!money || money.settled) return;
      for (const s of money.seats) {
        const p = players[s.pid];
        if (!p) continue;
        wallet(p).reserved = Math.max(0, wallet(p).reserved - s.engaged);
        // Annulation technique : le droit de table est rendu.
        if (s.fee) post(p, `fee-refund:${money.gameId}:${p.id}`, "fee", s.fee, { gameId: money.gameId, label: "Droit de table rendu (partie annulée)" });
      }
      money.settled = true;
      money.cancelled = reason;
    },
    // Abandon en cours de partie : la mise est perdue tout de suite, la place passe à la Maison.
    forfeit(players, money, pid, gameKey) {
      if (!money || money.settled) return null;
      const s = money.seats.find((x) => x.pid === pid);
      const p = players[pid];
      if (!s || !p) return null;
      wallet(p).reserved = Math.max(0, wallet(p).reserved - s.engaged);
      const lost = Math.min(money.stake, wallet(p).balance);
      const e = post(p, `forfeit:${gameKey}:${pid}`, "loss", -lost, { gameId: gameKey, stake: money.stake, engaged: s.engaged, label: "Abandon de la partie" });
      Object.assign(s, { pid: null, name: "Maison", house: true, engaged: money.stake * RUBICON });
      return e;
    },
    // Règlement atomique, exécuté une seule fois par partie.
    settle(players, money, scores, gameKey) {
      if (!money || money.settled) return null;
      const result = computeSettlement(money, scores);
      // Vérification avant toute écriture : pas de solde négatif, équilibre exact.
      for (const r of result.rows) {
        const p = players[r.pid];
        if (p && r.delta < 0 && wallet(p).balance + r.delta < 0) throw Error("Règlement incohérent");
      }
      if (result.rows.reduce((a, r) => a + r.delta, 0) !== 0) throw Error("Règlement déséquilibré");
      for (const r of result.rows) {
        const p = players[r.pid];
        if (!p) continue;
        wallet(p).reserved = Math.max(0, wallet(p).reserved - r.engaged);
        const e = post(p, `settle:${gameKey}:${r.pid}`, r.delta >= 0 ? "win" : "loss", r.delta, {
          gameId: gameKey,
          stake: money.stake,
          engaged: r.engaged,
          rubicon: result.rubicon,
          adjusted: r.adjusted,
          label: result.rubicon ? "Rubicon" : "Victoire simple",
        });
        r.balance = e ? e.balance : wallet(p).balance;
      }
      money.settled = true;
      money.result = result;
      return result;
    },
  };
}

// Calcul pur, testable : qui perd quoi, qui gagne quoi.
export function computeSettlement(money, scores) {
  const winTeam = scores[0] > scores[1] ? 0 : 1;
  const w = scores[winTeam],
    l = scores[1 - winTeam];
  const rubicon = w > 2 * l; // strictement plus du double
  const stake = money.stake;
  const losers = money.seats.filter((s) => s.seat % 2 !== winTeam);
  const winners = money.seats.filter((s) => s.seat % 2 === winTeam);
  const loss = losers.map((s) => Math.min(rubicon ? RUBICON * stake : stake, s.engaged));
  let total = loss.reduce((a, b) => a + b, 0);
  // Partage exact en demi-crédits : une unité impaire n'est pas prélevée (rien n'est créé).
  if (total % 2) {
    const i = loss.indexOf(Math.max(...loss));
    loss[i] -= 1;
    total -= 1;
  }
  const share = total / 2;
  const fullShare = (rubicon ? RUBICON : 1) * stake;
  const rows = [
    ...losers.map((s, i) => ({ seat: s.seat, pid: s.pid, name: s.name, engaged: s.engaged, delta: -loss[i], adjusted: false })),
    ...winners.map((s) => ({ seat: s.seat, pid: s.pid, name: s.name, engaged: s.engaged, delta: share, adjusted: share < fullShare })),
  ];
  return { winTeam, rubicon, total, share, stake, rows };
}

// ———————————————————————— vérification des paiements (côté serveur uniquement)
// Stripe (site web) : signature HMAC de l'en-tête Stripe-Signature.
export function verifyStripeSignature(raw, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(String(header ?? "").split(",").map((x) => x.split("=")));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const a = Buffer.from(expected),
    b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
