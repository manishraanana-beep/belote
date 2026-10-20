import http from "node:http";
import { WebSocketServer } from "ws";
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { createAccounts, createMailer, normalizeEmail } from "./accounts.js";
import { createEconomy, economyConfig, STAKES, toCredits, toUnits } from "./economy.js";
import { createProgression, TOURNAMENT_REWARDS } from "./progression.js";
import { createTournaments, validTimeZone } from "./tournaments.js";
import { pushConfig, sendFcm, sendWebPush } from "./push.js";
import { createShop, isShopAvatar } from "./shop.js";
import { createIntegrity, integrityConfig } from "./integrity.js";
import { stripeCheckout, stripeEvent, verifyAppleTransaction, verifyGooglePurchase } from "./purchases.js";
import path from "node:path";
import {
  newGame,
  act,
  view,
  botAction,
  nextDeal,
  expireCounter,
  strongestCard,
  DEFAULT_RULES,
} from "./engine.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = () => randomBytes(24).toString("base64url");
const clean = (v, max = 40) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
function check(ok, message) {
  if (!ok) throw Error(message);
}
function rules(input = {}) {
  const r = { ...DEFAULT_RULES };
  for (const k of [
    "target",
    "turnSeconds",
    "reconnectSeconds",
    "counterWindowSeconds",
    "capotValue",
  ]) {
    if (input[k] !== undefined) {
      check(Number.isInteger(input[k]), "Paramètre numérique invalide");
      r[k] = input[k];
    }
  }
  check(
    r.target >= 100 &&
      r.target <= 10000 &&
      r.turnSeconds >= 5 &&
      r.turnSeconds <= 120 &&
      r.reconnectSeconds >= 10 &&
      r.reconnectSeconds <= 600 &&
      r.counterWindowSeconds >= 2 &&
      r.counterWindowSeconds <= 30 &&
      r.capotValue >= 160 &&
      r.capotValue <= 500,
    "Règles hors limites",
  );
  for (const k of ["flyingCounter", "beloteRetained", "beloteCountsContract"])
    if (input[k] !== undefined) {
      check(typeof input[k] === "boolean", "Règle invalide");
      r[k] = input[k];
    }
  for (const [k, options] of [
    ["scoring", ["added", "contract"]],
    ["allPass", ["redeal", "rotate"]],
  ])
    if (input[k] !== undefined) {
      check(options.includes(input[k]), "Variante inconnue");
      r[k] = input[k];
    }
  return r;
}
// Avatars illustrés repris des maquettes du graphiste (public/avatars/<id>.webp) ; les robots ont leurs mascottes SVG.
export const AVATARS = ["jacques", "sophie", "camille", "emma", "malik", "henri", "leo", "chat", "chien"];
export const BOT_AVATARS = ["robot-bleu", "robot-corail", "robot-menthe", "robot-soleil"];
// Robots : prénoms et avatars tirés au hasard, jamais deux fois les mêmes à une table.
// Ils restent toujours signalés comme robots (badge « Robot ») : aucun ne se fait passer pour un joueur.
const BOT_NAMES = [
  "Léon", "Margot", "Basile", "Rosalie", "Gaston", "Suzon", "Firmin", "Odette", "Marcel", "Lucienne",
  "Jules", "Paulette", "Albert", "Yvette", "Émile", "Josette", "Fernand", "Ginette", "Lucien", "Colette",
  "Raymond", "Simone", "Gustave", "Madeleine", "Octave", "Huguette", "Anatole", "Germaine", "Félix", "Augustine",
  "Hector", "Clémence",
];
// Messages et réactions prédéfinis : impossible d'y décrire sa main à son partenaire.
export const REACTIONS = [
  { id: "bravo", text: "Bien joué !", emoji: "👏" },
  { id: "merci", text: "Merci partenaire !", emoji: "🤝" },
  { id: "belle", text: "Belle partie !", emoji: "🎉" },
  { id: "dommage", text: "Pas de chance !", emoji: "🍀" },
  { id: "rire", text: "", emoji: "😂" },
  { id: "feu", text: "", emoji: "🔥" },
  { id: "wow", text: "", emoji: "😮" },
  { id: "coeur", text: "", emoji: "❤️" },
];
export const REPORT_REASONS = {
  abuse: "Insultes ou harcèlement",
  spam: "Spam",
  cheat: "Suspicion de triche ou d’arrangement",
  profile: "Pseudo ou photo inappropriés",
  other: "Autre",
};
const validAvatar = (v, p) =>
  AVATARS.includes(v) || (typeof v === "string" && v.startsWith("u:") && v === p?.photo);
const hashPassword = (password, salt) =>
  scryptSync(password, salt, 32).toString("hex");
export function createApp({
  // Railway : un volume attaché est monté sur RAILWAY_VOLUME_MOUNT_PATH ; sans volume, le disque
  // est effacé à chaque déploiement (comptes, crédits et parties perdus).
  dataDir = process.env.BELOTE_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(root, ".data"),
  tickMs = 250,
  botDelay = 800,
  adminKey = process.env.BELOTE_ADMIN_KEY,
  fillSeconds = Number(process.env.BELOTE_FILL_SECONDS) || 8,
  // Arrivée des robots dans le salon : un toutes les 0,7 s, puis départ 1,5 s après (plus court si l'attente l'est).
  botStepMs = Math.min(700, fillSeconds * 500),
  startDelayMs = Math.min(1500, fillSeconds * 1000),
  env = process.env,
  reactionCooldownMs = 4000,
  clock = () => Date.now(), // horloge des tournois (remplaçable dans les tests)
  QUICK_REMATCH_WAIT = 15_000, // partie rapide : délai laissé aux autres pour accepter la revanche
  summaryMs = (Number(process.env.BELOTE_SUMMARY_SECONDS) || 5) * 1000, // résultat de la donne affiché avant la suivante
  inviteWaitMs = (Number(process.env.BELOTE_INVITE_WAIT_SECONDS) || 60) * 1000, // délai laissé aux invités avant les robots
  // Parties rapides et tables des villes : les joueurs en ligne sont appelés, et on les attend ce temps-là
  // avant les robots (le joueur peut demander les robots plus tôt). 0 : pas d'appel (ancien fonctionnement).
  matchWaitMs = (process.env.BELOTE_MATCH_WAIT_SECONDS !== undefined ? Number(process.env.BELOTE_MATCH_WAIT_SECONDS) : 45) * 1000,
} = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "state.json");
  let db = {
    players: {},
    tables: {},
    reports: [],
    settings: { maintenance: false },
  };
  if (existsSync(file)) db = JSON.parse(readFileSync(file, "utf8"));
  db.createdAt ??= Date.now();
  const ephemeral = !!env.RAILWAY_ENVIRONMENT && !env.RAILWAY_VOLUME_MOUNT_PATH && !env.BELOTE_DATA_DIR;
  if (ephemeral)
    console.error("ATTENTION : aucun volume Railway attaché. Les comptes et les crédits seront effacés au prochain déploiement. Ajoutez un volume au service (Settings › Volumes).");
  const economy = createEconomy(db, economyConfig(env));
  const progression = createProgression({ db, economy, env });
  const shop = createShop({ db, economy });
  // Mise de « Jouer maintenant » (robots compris) ; 0 pour la désactiver.
  const QUICK_STAKE = Number(env.BELOTE_QUICK_STAKE ?? 200);
  const avatarOk = (v, p) => validAvatar(v, p) || (isShopAvatar(v) && !!p && shop.owns(p, v));
  const integrity = createIntegrity(db, integrityConfig(env));
  const pushCfg = pushConfig(env);
  const tournaments = createTournaments({
    db,
    now: clock,
    rewardIds: TOURNAMENT_REWARDS.map((r) => r.id),
    hooks: {
      available: (p) => toCredits(economy.available(p)),
      notify: (pid, msg) => deliver(pid, msg),
      launchMatch: (tour, m, a, b) => launchMatch(tour, m, a, b),
      endTable: (tableId) => endTournamentTable(tableId),
      award: (p, reward) => progression.award(p, reward),
      prize: (p, credits, key, name) => {
        if (economy.post(p, key, "tournoi", toUnits(credits), { label: `Enjeu — ${name}` }))
          deliver(p.id, { title: "Gain de tournoi", body: `${credits} crédits crédités pour « ${name} ».`, kind: "gain" });
      },
    },
  });
  const photoDir = path.join(dataDir, "avatars");
  mkdirSync(photoDir, { recursive: true, mode: 0o700 });
  // Anciens avatars (symboles) : remplacés par un avatar illustré.
  for (const p of Object.values(db.players))
    if (!avatarOk(p.avatar, p)) p.avatar = AVATARS[0];
  for (const t of Object.values(db.tables))
    for (const s of t.seats)
      if (s && !avatarOk(s.avatar, db.players[s.id]) && !BOT_AVATARS.includes(s.avatar))
        s.avatar = s.bot ? BOT_AVATARS[0] : AVATARS[0];
  const tagOf = () => "MB-" + randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  function socialDefaults(p) {
    p.tag ??= tagOf();
    p.friends ??= {};
    p.friendIn ??= [];
    p.friendOut ??= [];
    p.blocked ??= {};
    p.hidden ??= {};
    p.invites ??= [];
    p.settings ??= { hideStatus: false, invites: "all", animations: true, sounds: true };
    // Les joueurs en ligne peuvent désormais être invités par tous (réglable dans les paramètres).
    if (!p.settings.onlineInvites) {
      if (p.settings.invites === "friends") p.settings.invites = "all";
      p.settings.onlineInvites = true;
    }
  }
  for (const p of Object.values(db.players)) socialDefaults(p);
  function newPlayer() {
    const p = {
      id: id(),
      token: null,
      name: "Joueur " + randomBytes(2).toString("hex"),
      avatar: AVATARS[randomBytes(1)[0] % AVATARS.length],
      stats: { games: 0, wins: 0 },
      history: [],
      tableId: null,
      seen: [],
      created: Date.now(),
    };
    socialDefaults(p);
    db.players[p.id] = p;
    return p;
  }
  function makeBot(seat, replaced, t) {
    const pick = (list, taken) => {
      const free = list.filter((x) => !taken.includes(x));
      const pool = free.length ? free : list;
      return pool[randomInt(pool.length)];
    };
    const others = (t?.seats ?? []).filter(Boolean);
    return {
      id: "bot-" + id(),
      name: pick(BOT_NAMES, others.map((s) => s.name)),
      avatar: pick([...AVATARS, ...BOT_AVATARS], others.map((s) => s.avatar)),
      bot: true,
      replaced: replaced ?? null,
    };
  }
  function retirePlayer(p) {
    if (p.tableId) leave(p, true);
    for (const ws of connections.get(p.id) ?? []) ws.close(4001, "Session terminée");
    if (p.photo) {
      try {
        unlinkSync(path.join(photoDir, p.photo.slice(2) + ".jpg"));
      } catch {}
    }
    for (const t of Object.values(db.tables)) t.pending = t.pending.filter((x) => x !== p.id);
    for (const o of Object.values(db.players)) {
      delete o.friends?.[p.id];
      o.friendIn = (o.friendIn ?? []).filter((x) => x !== p.id);
      o.friendOut = (o.friendOut ?? []).filter((x) => x !== p.id);
      o.invites = (o.invites ?? []).filter((x) => x.from !== p.id);
    }
    delete db.players[p.id];
  }
  const baseUrl = (req) =>
    process.env.BELOTE_PUBLIC_URL?.replace(/\/$/, "") ||
    `${req.socket.encrypted || process.env.BELOTE_SECURE_COOKIE === "true" ? "https" : "http"}://${req.headers.host}`;
  let closing = false;
  const connections = new Map(),
    rate = new Map();
  function persist() {
    writeFileSync(file + ".tmp", JSON.stringify(db), { mode: 0o600 });
    renameSync(file + ".tmp", file);
  }
  // Code d'invitation court et lisible (ex. VIP-482), unique parmi les tables ouvertes.
  function shortCode() {
    for (let digits = 3; ; digits++)
      for (let i = 0; i < 20; i++) {
        const c = "VIP-" + String(randomBytes(4).readUInt32BE() % 10 ** digits).padStart(digits, "0");
        if (!Object.values(db.tables).some((t) => t.code === c)) return c;
      }
  }
  function table(name, owner, vip = false, r = {}, stake = 0) {
    const t = {
      stake,
      money: null,
      rematch: null,
      reactions: [],
      results: null,
      id: id(),
      name,
      owner,
      vip,
      rules: rules(r),
      seats: [null, null, null, null],
      pending: [],
      chat: [],
      game: null,
      quick: false,
      fillAt: null,
      invite: vip ? id() : null,
      code: vip ? shortCode() : null,
      host: owner,
      password: null,
      revision: 0,
      deadline: null,
      botAt: 0,
      created: Date.now(),
    };
    db.tables[t.id] = t;
    return t;
  }
  // Tables publiques permanentes : partie gratuite et mises de 200, 500 et 1 000 jetons.
  // Tables permanentes : une ville et un tapis par montant.
  const CITIES = { 500: ["paris", "Paris"], 1000: ["monaco", "Monaco"], 2500: ["dubai", "Dubaï"], 10000: ["vegas", "Las Vegas"] };
  const LOBBY = (env.BELOTE_LOBBY_STAKES ?? "500,1000,2500,10000").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  // Une table permanente dont le montant n'est plus proposé est retirée (si personne n'y joue).
  for (const t of Object.values(db.tables))
    if (t.lobby && !LOBBY.includes(t.stake ?? 0) && !t.seats.some((x) => x && !x.bot)) delete db.tables[t.id];
  for (const t of Object.values(db.tables))
    if (!t.vip && !t.quick && !t.practice && !t.lobby && !t.createdBy && /^Le Salon/.test(t.name)) {
      t.lobby = true;
      t.name = "Le Salon • Partie gratuite";
    }
  // Tables déjà enregistrées : elles prennent le nom de leur ville.
  for (const t of Object.values(db.tables)) if (t.lobby && CITIES[t.stake]) t.name = CITIES[t.stake][1];
  function ensureLobby() {
    let changed = false;
    for (const stake of LOBBY) {
      const list = Object.values(db.tables).filter((t) => t.lobby && (t.stake ?? 0) === stake);
      const open = list.filter((t) => (!t.game || t.game.phase === "finished") && t.seats.some((x) => !x));
      if (!open.length) {
        const t = table(CITIES[stake]?.[1] ?? (stake ? `Table à ${stake.toLocaleString("fr-FR")} jetons` : "Le Salon • Partie gratuite"), null, false, {}, stake);
        t.lobby = true;
        t.houseBots = stake > 0;
        changed = true;
      }
      // Pas plus d'une table vide par montant.
      const empty = list.filter((t) => !t.game && !t.seats.some(Boolean));
      for (const t of empty.slice(1)) {
        delete db.tables[t.id];
        changed = true;
      }
    }
    return changed;
  }
  ensureLobby();
  // No live connection survives a server restart. Reservations restart with the configured grace.
  for (const t of Object.values(db.tables))
    for (const s of t.seats) if (s && !s.bot) s.disconnectedAt = Date.now();
  const send = (ws, msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  // Notification : boîte de réception dans l'application (toujours), puis push navigateur et
  // natif si le joueur les a autorisés. Un échec d'envoi n'interrompt jamais le tournoi.
  function deliver(pid, msg) {
    const p = db.players[pid];
    if (!p) return;
    const notice = { id: id(), at: Date.now(), read: false, ...msg };
    p.inbox = [notice, ...(p.inbox ?? [])].slice(0, 30);
    for (const ws of connections.get(pid) ?? []) send(ws, { type: "notice", notice });
    const payload = { title: msg.title, body: msg.body, url: msg.url ?? "/", tag: `${msg.tournament ?? "contree"}:${msg.kind ?? ""}` };
    for (const sub of p.push?.web ?? [])
      sendWebPush(sub, payload, pushCfg)
        .then((r) => {
          if (r === "gone") p.push.web = p.push.web.filter((x) => x !== sub);
        })
        .catch((e) => console.error("Push web impossible :", e.message));
    for (const token of p.push?.fcm ?? [])
      sendFcm(token.token, payload, pushCfg)
        .then((r) => {
          if (r === "gone") p.push.fcm = p.push.fcm.filter((x) => x !== token);
        })
        .catch((e) => console.error("Push natif impossible :", e.message));
  }
  // Table d'une rencontre de tournoi : équipe « a » aux places 0 et 2, équipe « b » aux places 1 et 3.
  function launchMatch(tour, m, a, b) {
    const t = table(`${tour.name}`, null, true, { ...tour.rules, reconnectSeconds: tour.reconnectSeconds });
    t.invite = null;
    t.code = null;
    t.host = null;
    t.tournament = { id: tour.id, match: m.id, name: tour.name, round: m.round, forfeitSeconds: tour.forfeitSeconds };
    const order = [a.pids[0], b.pids[0], a.pids[1], b.pids[1]];
    order.forEach((pid, seat) => {
      const p = db.players[pid];
      if (p.tableId && p.tableId !== t.id && db.tables[p.tableId]) leave(p, true);
      p.tableId = t.id;
      t.seats[seat] = { id: pid, name: p.name, avatar: p.avatar, ...(connections.has(pid) ? {} : { disconnectedAt: Date.now() }) };
    });
    start(t);
    return t.id;
  }
  function endTournamentTable(tableId) {
    const t = db.tables[tableId];
    if (!t) return;
    for (const s of t.seats) if (s && !s.bot && db.players[s.id]?.tableId === t.id) db.players[s.id].tableId = null;
    delete db.tables[tableId];
  }
  // Pseudos uniques, sans tenir compte des majuscules, des accents ni des espaces.
  const nameKey = (n) => String(n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  function nameTaken(name, exceptId) {
    const k = nameKey(name);
    return Object.values(db.players).some((o) => o.id !== exceptId && o.name && nameKey(o.name) === k);
  }
  // Joueurs connectés que l'on peut inviter à sa table (hors parties en cours, blocages et refus).
  function onlinePlayers(p, t) {
    const out = [];
    for (const id of connections.keys()) {
      const o = db.players[id];
      if (!o || o.id === p.id || o.banned || o.settings?.hideStatus || blockedEither(p, o)) continue;
      const policy = o.settings?.invites ?? "all";
      if (policy === "none" || (policy === "friends" && !o.friends?.[p.id])) continue;
      const ot = db.tables[o.tableId];
      if (ot?.id === t.id) continue;
      const busy = !!(ot?.game && ot.game.phase !== "finished");
      out.push({ id: o.id, name: o.name, avatar: o.avatar, tag: o.tag, busy, invited: o.invites.some((i) => i.tableId === t.id), friend: !!p.friends?.[o.id] });
      if (out.length >= 30) break;
    }
    return out.sort((a, b) => a.busy - b.busy || b.friend - a.friend);
  }
  // La roue se tourne à la demande du joueur (commande « spin ») : plus de versement automatique.
  function loginBonus(p) {
    const e = economy.loginBonus(p);
    if (!e) return null;
    persist();
    return e;
  }
  function publicTable(t) {
    return {
      id: t.id,
      name: t.name,
      vip: t.vip,
      available: t.seats.filter((s) => !s).length,
      status:
        t.game && !["finished"].includes(t.game.phase)
          ? "Partie en cours"
          : "En attente",
      rules: t.rules,
      quick: !!t.quick,
      fillAt: t.fillAt,
      stake: t.stake ?? 0,
      practice: !!t.practice,
      fillBots: !!t.fillBots,
      lobby: !!t.lobby,
      city: t.lobby ? (CITIES[t.stake]?.[0] ?? null) : null,
      humans: t.seats.filter((s) => s && !s.bot).length,
      calls: callInfo(t),
    };
  }
  function publicSeat(s) {
    return s
      ? {
          id: s.id,
          name: s.name,
          avatar: s.avatar,
          bot: !!s.bot,
          replaced: s.replaced ?? null,
          frame: s.bot ? null : (db.players[s.id]?.progress?.equipped?.frame ?? null),
          tag: s.bot ? null : db.players[s.id]?.tag,
          connected: s.bot || connections.has(s.id),
          disconnectedAt: s.disconnectedAt ?? null,
        }
      : null;
  }
  function snapshot(t, pid) {
    const seat = t.seats.findIndex((s) => s?.id === pid);
    return {
      ...publicTable(t),
      owner: t.owner,
      gameId: t.gameId,
      seats: t.seats.map(publicSeat),
      revision: t.revision,
      deadline: t.deadline,
      chat: t.chat,
      pending:
        pid === t.owner
          ? t.pending.map((p) => ({ id: p, name: db.players[p]?.name }))
          : [],
      invite: pid === t.owner ? t.invite : undefined,
      code: t.seats.some((s) => s?.id === pid) ? t.code : undefined,
      vip: t.vip,
      host: t.host,
      game: t.game ? view(t.game, seat >= 0 ? seat : null) : null,
      // Crédits engagés (ou, avant lancement, ce qui serait engagé) pour chaque place.
      money: t.money
        ? { stake: toCredits(t.money.stake), settled: t.money.settled, cancelled: t.money.cancelled ?? null, seats: t.money.seats.map((x) => ({ seat: x.seat, name: x.name, engaged: toCredits(x.engaged) })) }
        : null,
      engagedPreview: t.stake
        ? t.seats.map((s) => {
            const p = s && !s.bot ? db.players[s.id] : null;
            return p ? { engaged: toCredits(Math.min(economy.available(p), 2 * t.stake)), enough: economy.available(p) >= 2 * t.stake, account: !!p.accountId } : null;
          })
        : null,
      rematch: t.rematch ? { votes: t.rematch.votes, blocked: t.rematch.blocked ?? [] } : null,
      reactions: t.reactions.filter((r) => Date.now() - r.at < 6000),
      result: t.results?.[pid] ?? null,
      tournament: t.tournament ? { id: t.tournament.id, name: t.tournament.name } : null,
      nextAt: t.game?.phase === "summary" ? (t.nextAt ?? Date.now() + summaryMs) : null,
    };
  }
  function playerView(p) {
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      photo: p.photo ?? null,
      stats: p.stats,
      history: p.history,
      banned: !!p.banned,
      account: accounts.view(p),
      tag: p.tag,
      lastResult: p.lastResult ?? null,
      myTables: Object.values(db.tables)
        .filter((t) => !t.practice && !t.lobby && (t.vip ? t.host === p.id : t.createdBy === p.id))
        .map((t) => ({ id: t.id, name: t.name, vip: !!t.vip, code: t.code, stake: t.stake ?? 0, players: t.seats.filter(Boolean).length, avatars: t.seats.filter(Boolean).map((s) => s.avatar), playing: !!t.game && t.game.phase !== "finished" })),
      wallet: economy.view(p),
      timeZone: p.timeZone ?? null,
      inbox: (p.inbox ?? []).slice(0, 20),
      push: { web: p.push?.web?.length ?? 0, native: p.push?.fcm?.length ?? 0 },
      progress: progression.view(p),
      shop: shop.view(p),
      settings: p.settings,
      hidden: Object.keys(p.hidden),
      blocked: Object.keys(p.blocked),
      friends: Object.entries(p.friends)
        .map(([id, f]) => {
          const o = db.players[id];
          if (!o) return null;
          const online = connections.has(id) && !o.settings?.hideStatus;
          const t = db.tables[o.tableId];
          return {
            id,
            name: o.name,
            avatar: o.avatar,
            tag: o.tag,
            favorite: !!f.favorite,
            status: !online ? "offline" : t?.game && t.game.phase !== "finished" ? "playing" : "available",
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.favorite - a.favorite || a.name.localeCompare(b.name)),
      friendIn: p.friendIn.map((id) => db.players[id] && { id, name: db.players[id].name, avatar: db.players[id].avatar, tag: db.players[id].tag }).filter(Boolean),
      friendOut: p.friendOut.map((id) => db.players[id] && { id, name: db.players[id].name }).filter(Boolean),
      invites: p.invites
        .filter((i) => db.tables[i.tableId] && Date.now() - i.at < 30 * 60_000)
        .map((i) => {
          const t = db.tables[i.tableId];
          return { id: i.id, from: i.fromName, tableId: t.id, table: t.name, vip: t.vip, stake: t.stake ?? 0, rules: t.rules, free: t.seats.filter((s) => !s).length, started: !!t.game && t.game.phase !== "finished" };
        }),
    };
  }
  function broadcast() {
    if (closing) return;
    persist();
    for (const [pid, set] of connections) {
      const p = db.players[pid];
      if (!p) continue;
      const t = db.tables[p.tableId];
      for (const ws of set)
        send(ws, {
          type: "state",
          player: playerView(p),
          tables: Object.values(db.tables)
            .filter((t) => !t.vip)
            .map(publicTable),
          table: t ? snapshot(t, pid) : null,
          requests: Object.values(db.tables)
            .filter((t) => t.pending.includes(pid))
            .map((t) => ({ id: t.id, name: t.name })),
          maintenance: db.settings.maintenance,
          tournaments: tournaments.list(pid),
          online: t && !t.game ? onlinePlayers(p, t) : [],
        });
    }
  }
  function schedule(t) {
    t.deadline =
      t.game && ["bidding", "playing"].includes(t.game.phase)
        ? Date.now() + t.rules.turnSeconds * 1000
        : null;
    // Pli qui vient d'être complété : on laisse aux joueurs le temps de voir les 4 cartes.
    const trickJustDone = t.game?.phase === "playing" && t.game.trick?.length === 0 && t.game.tricks?.length > 0;
    t.botAt = Date.now() + (trickJustDone && botDelay >= 200 ? Math.max(botDelay, 1600) : botDelay);
    // Dernier tour : une carte toutes les 0,7 s (après l'affichage du pli précédent).
    t.lastCardAt = Date.now() + (botDelay >= 200 ? (trickJustDone ? 1700 : 700) : botDelay);
  }
  function update(t) {
    t.revision++;
    schedule(t);
  }
  function finishStats(t) {
    if (t.game.phase !== "finished" || t.recorded === t.gameId) return;
    t.recorded = t.gameId;
    const g = t.game;
    // Règlement des crédits (atomique, une seule fois grâce à la clé de partie).
    let settlement = null;
    if (t.money && !t.money.settled) {
      settlement = economy.settle(db.players, t.money, g.scores, t.gameId);
      if (settlement) integrity.settlement(t.gameId, settlement);
    }
    const winTeam = g.scores[0] > g.scores[1] ? 0 : 1;
    const rubicon = g.scores[winTeam] > 2 * g.scores[1 - winTeam];
    const humans = t.seats.filter((s) => s && !s.bot).map((s) => s.id).sort();
    const lineup = humans.join("|");
    t.results = {};
    for (let seat = 0; seat < 4; seat++) {
      const s = t.seats[seat],
        p = s && !s.bot ? db.players[s.id] : null;
      if (!p) continue;
      const won = seat % 2 === winTeam;
      p.stats.games++;
      if (won) p.stats.wins++;
      const row = settlement?.rows.find((r) => r.pid === p.id);
      const team = seat % 2;
      const capot = g.history.some((h) => h.contract.amount === 250 && h.made && h.contract.seat % 2 === team);
      const counterWin = g.history.some((h) => h.multiplier > 1 && !h.made && h.contract.seat % 2 !== team);
      const prog = progression.record(p, {
        practice: t.practice ?? false,
        won,
        rubicon,
        capot,
        counterWin,
        vipHost: t.vip && t.owner === p.id && !t.practice,
        deals: g.history.length,
        durationMs: Date.now() - (t.startedAt ?? Date.now()),
        lineup,
      });
      if (!prog.counted && !t.practice) integrity.repetition(lineup, p.progress.daily[Object.keys(p.progress.daily)[0]]["lineup:" + lineup]);
      p.history.unshift({
        table: t.name,
        date: Date.now(),
        scores: [g.scores[team], g.scores[1 - team]],
        won,
        rubicon,
        gameId: t.gameId,
        stake: t.stake ?? 0,
        delta: row ? toCredits(row.delta) : 0,
      });
      p.history = p.history.slice(0, 30);
      t.results[p.id] = {
        won,
        rubicon,
        stake: t.stake ?? 0,
        engaged: row ? toCredits(row.engaged) : 0,
        delta: row ? toCredits(row.delta) : 0,
        adjusted: !!row?.adjusted,
        balance: row ? toCredits(row.balance) : toCredits(economy.wallet(p).balance),
        xp: prog.xp,
        level: prog.level,
        badges: prog.badges,
        challenges: prog.challenges.map((c) => c.label),
      };
    }
    if (t.tournament) tournaments.matchFinished(t.id, winTeam, g.scores);
    // Les joueurs remplacés par un robot restent engagés : leur résultat leur est aussi communiqué.
    for (const r of settlement?.rows ?? []) {
      if (t.results[r.pid] || !db.players[r.pid]) continue;
      t.results[r.pid] = { won: r.delta > 0, rubicon, stake: t.stake, engaged: toCredits(r.engaged), delta: toCredits(r.delta), adjusted: r.adjusted, balance: toCredits(r.balance), xp: 0, replaced: true };
      db.players[r.pid].lastResult = { table: t.name, ...t.results[r.pid] };
    }
  }
  function start(t) {
    endCalls(t);
    check(t.seats.every(Boolean), "Il faut quatre joueurs");
    // Tables publiques et « Jouer maintenant » : règles de la maison (1 000 points, donneur suivant si tous passent),
    // y compris pour les tables enregistrées avant ce changement.
    if (t.quick || t.lobby) Object.assign(t.rules, { target: DEFAULT_RULES.target, allPass: "rotate" });
    const gameId = id();
    if (t.houseBots) {
      // Partie rapide : les robots jouent pour la Maison. La mise d'origine est reprise à chaque partie
      // (revanche comprise) ; elle n'est suspendue que si un joueur n'a pas de compte ou pas les crédits.
      t.quickStake ??= t.stake;
      const humans = t.seats.filter((s) => !s.bot).map((s) => db.players[s.id]);
      t.stake = humans.some((h) => !h?.accountId || economy.available(h) < toUnits(t.quickStake)) ? 0 : t.quickStake;
    }
    if (t.stake) {
      if (!t.houseBots) check(t.seats.every((s) => !s.bot), "Les parties avec crédits se jouent entre quatre joueurs");
      check(t.seats.every((s) => s.bot || db.players[s.id]?.accountId), "Chaque joueur doit avoir un compte pour miser des crédits");
      t.gameId = gameId;
      t.money = economy.reserve(t, t.seats.map((s) => (s.bot ? null : db.players[s.id])), { house: !!t.houseBots });
    } else t.money = null;
    t.game = newGame(t.rules);
    t.gameId = gameId;
    t.startedAt = Date.now();
    t.rematch = null;
    t.results = null;
    update(t);
  }
  // Annulation technique : réservations libérées, ni gain ni perte.
  function cancelGame(t, reason) {
    if (t.money && !t.money.settled) {
      economy.release(db.players, t.money, reason);
      for (const x of t.money.seats) {
        const p = db.players[x.pid];
        if (p) economy.post(p, `cancel:${t.gameId}:${p.id}`, "cancel", 0, { gameId: t.gameId, label: reason, engaged: x.engaged, stake: t.money.stake });
      }
    }
    t.game = null;
    t.rematch = null;
    t.seats = t.seats.map((s) => (s?.bot && s.owner ? null : s));
    update(t);
  }
  // Revanche : chaque joueur confirme ; lancement automatique quand les quatre sont d'accord.
  function voteRematch(t, pid, accept) {
    check(t.game?.phase === "finished", "La partie n’est pas terminée");
    check(!t.tournament, "Rencontre de tournoi : la suite se joue au tour suivant");
    t.rematch ??= { votes: {}, blocked: [] };
    if (!accept && (t.quick || t.lobby)) {
      // Partie rapide : celui qui refuse s'en va seul ; un robot prendra sa place pour les autres.
      leave(db.players[pid]);
      return;
    }
    if (!accept) {
      // Retour au salon avec les participants restants.
      t.game = null;
      t.rematch = null;
      t.seats = t.seats.map((s) => (s?.bot && (t.stake || s.owner) ? null : s));
      return;
    }
    t.rematch.votes[pid] = true;
    // « Jouer maintenant » : les absents sont remplacés par des robots, sans attendre personne.
    if (t.quick || t.lobby) {
      t.rematch.deadline ??= Date.now() + QUICK_REMATCH_WAIT;
      for (let i = 0; i < 4; i++) {
        if (!t.seats[i]) t.seats[i] = makeBot(i, null, t);
        else if (t.seats[i].bot && t.seats[i].owner) t.seats[i] = { ...t.seats[i], owner: null };
      }
    }
    tryRematch(t);
  }
  // Revanche prête : tout le monde a dit oui (les robots de la Maison votent d'office).
  function tryRematch(t) {
    if (!t.rematch) return;
    const botsVote = !t.stake || t.houseBots;
    for (const s of t.seats) if (s?.bot && botsVote && !s.owner) t.rematch.votes[s.id] = true;
    const ready = t.seats.every((s) => s && t.rematch.votes[s.id]);
    if (!ready) return;
    if (t.stake) {
      t.rematch.blocked = t.seats.filter((s) => (s.bot ? !t.houseBots : economy.available(db.players[s.id]) < 2 * t.stake)).map((s) => s.name);
      if (t.rematch.blocked.length) return;
    }
    start(t);
  }
  // Partie rapide : un joueur qui n'a pas répondu à la revanche à temps laisse sa place à un robot.
  function expireQuickRematch(t, now) {
    if (!(t.quick || t.lobby) || !t.rematch?.deadline || now < t.rematch.deadline || t.game?.phase !== "finished") return false;
    for (let i = 0; i < 4; i++) {
      const s = t.seats[i];
      if (s && !s.bot && !t.rematch.votes[s.id]) {
        const p = db.players[s.id];
        if (p?.tableId === t.id) p.tableId = null;
        t.seats[i] = makeBot(i, null, t);
      }
    }
    t.rematch.deadline = null;
    tryRematch(t);
    if (t.game?.phase === "finished") update(t);
    return true;
  }
  // Départ d'une table. Pendant une partie, un robot reprend aussitôt la main et la place :
  // les cartes, le contrat et les scores sont conservés pour les autres joueurs.
  function leave(p, force = false) {
    const t = db.tables[p.tableId];
    p.tableId = null;
    if (!t) return;
    const seat = t.seats.findIndex((s) => s?.id === p.id);
    const playing = t.game && t.game.phase !== "finished";
    if (t.tournament && playing && seat >= 0 && tournaments.isTournamentTable(t.id)) {
      // Pas de robot en tournoi : quitter une rencontre en cours vaut forfait de l'équipe.
      tournaments.forfeit(t.id, seat % 2, `Abandon de ${p.name}`);
      return;
    }
    if (seat >= 0) {
      t.seats[seat] = playing ? { ...makeBot(seat, p.name, t), owner: p.id } : null;
      if (playing && t.money && !t.money.settled) integrity.leave(p.id, t.gameId);
      if (playing && t.money && !t.money.settled) economy.forfeit(db.players, t.money, p.id, t.gameId);
    }
    if (t.rematch) delete t.rematch.votes[p.id];
    if (t.owner === p.id) t.owner = t.seats.find((s) => s && !s.bot)?.id ?? (t.vip && !t.practice && t.host === p.id ? p.id : null);
    if (!t.seats.some((s) => s && !s.bot) && !(playing && t.money && !t.money.settled)) {
      // Plus aucun humain : on ne fait pas jouer quatre robots dans le vide
      // (sauf partie avec crédits engagés, menée à son terme pour un règlement valide).
      if (t.vip && !t.practice && t.host) {
        // Table privée conservée pour son hôte (« Mes tables privées ») ; elle se vide simplement.
        t.seats = t.seats.map(() => null);
        if (!(playing && t.money && !t.money.settled)) t.game = null;
        t.owner = t.host;
        t.idleSince = Date.now();
        update(t);
      } else if (t.vip || t.quick) delete db.tables[t.id];
      else {
        t.seats = [null, null, null, null];
        t.game = null;
        t.fillAt = null;
        update(t);
      }
      ensureLobby();
      return;
    }
    if (force && !playing && seat < 0) return;
    update(t);
  }
  function validateInvite(target, d) {
    check(target, "Table introuvable");
    if (target.vip) {
      check(
        (typeof d.invite === "string" && d.invite === target.invite) ||
          (typeof d.code === "string" && d.code.toUpperCase() === target.code),
        "Invitation invalide",
      );
      if (target.password)
        check(
          typeof d.password === "string" &&
            d.password.length <= 128 &&
            timingSafeEqual(
              Buffer.from(
                hashPassword(d.password, target.password.salt),
                "hex",
              ),
              Buffer.from(target.password.hash, "hex"),
            ),
          "Mot de passe incorrect",
        );
    }
  }
  function consume(pid) {
    const now = Date.now();
    let r = rate.get(pid);
    if (!r || now - r.at > 1000) {
      r = { at: now, n: 0 };
      rate.set(pid, r);
    }
    check(++r.n <= 25, "Trop de requêtes");
  }
  // Le joueur doit disposer de la mise, sans compter les crédits déjà réservés ailleurs.
  function canStake(p, stake) {
    if (!stake) return;
    check(p.accountId, "Créez un compte pour jouer avec des crédits");
    if (economy.available(p) < stake * 2) {
      const e = Error(`Solde insuffisant : il faut ${stake} crédits disponibles pour cette table.`);
      e.code = "funds";
      throw e;
    }
  }
  const stakeOf = (v) => {
    const n = Number(v ?? 0);
    check(n === 0 || STAKES.includes(n), "Mise invalide");
    return n;
  };
  const blockedEither = (a, b) => !!(a.blocked?.[b.id] || b.blocked?.[a.id]);
  // Tables permanentes avec mise : départ automatique dès que quatre joueurs sont assis.
  function autoStart(target) {
    if (!target.lobby || (target.game && target.game.phase !== "finished")) return;
    // Places encore libres après le délai : complétées par des robots (les joueurs déjà assis restent ensemble).
    if (!target.seats.every(Boolean)) {
      target.fillAt ??= Date.now() + fillSeconds * 1000;
      return;
    }
    target.fillAt = null;
    try {
      start(target);
    } catch (e) {
      console.error("Départ automatique impossible :", e.message);
    }
  }
  // Joueurs réels d'abord : tables publiques ou rapides de même mise, pas encore lancées,
  // où au moins un joueur attend et une place est libre (les plus remplies en premier).
  const humansAt = (x) => x.seats.filter((s) => s && !s.bot).length;
  const stakeKey = (x) => x.quickStake ?? x.stake ?? 0;
  function waitingTables(stake, exclude) {
    return Object.values(db.tables)
      .filter((x) => (x.quick || x.lobby) && x !== exclude && (!x.game || (x.game.phase === "finished" && !x.rematch)) && stakeKey(x) === stake && humansAt(x) > 0 && x.seats.includes(null))
      .sort((a, b) => humansAt(b) - humansAt(a));
  }
  // Avant d'installer des robots : on rapatrie les joueurs qui attendent seuls à une autre table compatible.
  function gatherHumans(t) {
    for (const x of waitingTables(stakeKey(t), t)) {
      for (let i = 0; i < 4 && t.seats.includes(null); i++) {
        const s = x.seats[i];
        if (!s || s.bot) continue;
        x.seats[i] = null;
        t.seats[t.seats.indexOf(null)] = s;
        if (db.players[s.id]) db.players[s.id].tableId = t.id;
      }
      if (!x.seats.some(Boolean)) {
        x.fillAt = null;
        if (x.quick) delete db.tables[x.id];
      } else if (x.owner && !x.seats.some((s) => s?.id === x.owner)) x.owner = x.seats.find((s) => s && !s.bot)?.id ?? null;
      update(x);
    }
  }
  // ———— Appel des joueurs en ligne : « Voulez-vous jouer avec … sur la partie à … jetons ? »
  const notPlaying = (x) => !x.game || x.game.phase === "finished";
  const waitingForPlayers = (x) => (x.quick || x.lobby) && notPlaying(x) && !x.rematch && x.seats.includes(null) && x.seats.some((s) => s && !s.bot);
  function callable(x, p) {
    if (!p || p.banned || !(connections.get(p.id)?.size > 0)) return false;
    if (x.seats.some((s) => s?.id === p.id)) return false;
    const cur = p.tableId && db.tables[p.tableId];
    if (cur && (cur.game ? cur.game.phase !== "finished" : cur.seats.some((s) => s && !s.bot && s.id !== p.id) || cur.tournament)) return false;
    if (x.seats.some((s) => s && !s.bot && blockedEither(p, db.players[s.id] ?? {}))) return false;
    const stake = stakeKey(x);
    if (stake && (!p.accountId || economy.available(p) < toUnits(stake))) return false;
    return true;
  }
  function callPlayers(x, now) {
    if (!matchWaitMs || !waitingForPlayers(x)) return false;
    x.calls ??= { sent: {}, declined: {} };
    if (!x.matchUntil) {
      x.matchUntil = now + matchWaitMs;
      x.fillAt = Math.max(x.fillAt ?? 0, x.matchUntil);
    }
    let sent = false;
    const names = x.seats.filter((s) => s && !s.bot).map((s) => s.name);
    for (const p of Object.values(db.players)) {
      if (x.calls.sent[p.id] || x.calls.declined[p.id] || !callable(x, p)) continue;
      x.calls.sent[p.id] = now;
      sent = true;
      for (const ws of connections.get(p.id) ?? []) send(ws, { type: "tableCall", tableId: x.id, players: names, stake: stakeKey(x), city: x.lobby ? (CITIES[x.stake]?.[1] ?? null) : null, until: x.matchUntil });
    }
    return sent;
  }
  // Table remplie ou lancée : les appels encore affichés disparaissent.
  function endCalls(x) {
    if (!x.calls) return;
    for (const pid of Object.keys(x.calls.sent)) for (const ws of connections.get(pid) ?? []) send(ws, { type: "callCancel", tableId: x.id });
    x.calls = null;
    x.matchUntil = null;
  }
  const callInfo = (x) => {
    if (!x.calls) return null;
    const sent = Object.keys(x.calls.sent);
    const declined = sent.filter((id) => x.calls.declined[id]).length;
    const joined = sent.filter((id) => x.seats.some((s) => s?.id === id)).length;
    return { sent: sent.length, declined, joined, pending: sent.length - declined - joined, until: x.matchUntil };
  };
  function seatPlayer(target, p, seat = target.seats.indexOf(null)) {
    check(seat >= 0 && !target.seats[seat], "Table complète");
    target.seats[seat] = { id: p.id, name: p.name, avatar: p.avatar };
    p.tableId = target.id;
    if (!target.owner) target.owner = p.id;
  }
  function command(pid, msg) {
    const p = db.players[pid];
    check(!p.banned, "Profil suspendu");
    check(
      msg &&
        typeof msg === "object" &&
        typeof msg.id === "string" &&
        msg.id.length <= 100,
      "Identifiant de commande requis",
    );
    if (p.seen.includes(msg.id)) return { duplicate: true };
    consume(pid);
    const d = msg.data ?? {},
      t = db.tables[p.tableId];
    let changed, reply;
    switch (msg.type) {
      case "profile":
        if (d.name !== undefined) {
          const name = clean(d.name, 24);
          check(name.length >= 2, "Pseudo trop court");
          check(!nameTaken(name, pid), "Ce pseudo est déjà pris, choisissez-en un autre");
          p.name = name;
        }
        if (d.avatar !== undefined) {
          check(avatarOk(d.avatar, p), "Avatar inconnu");
          p.avatar = d.avatar;
        }
        if (t) {
          const s = t.seats.find((s) => s?.id === pid);
          if (s) {
            s.name = p.name;
            s.avatar = p.avatar;
          }
        }
        break;
      case "create":
        rules(d.rules);
        if (d.password)
          check(
            typeof d.password === "string" && d.password.length <= 128,
            "Mot de passe invalide",
          );
        check(!db.settings.maintenance, "Création temporairement fermée");
        if (p.tableId) leave(p);
        check(
          Object.values(db.tables).filter((t) => t.owner === pid).length < 5,
          "Maximum cinq tables",
        );
        {
          const stake = stakeOf(d.stake);
          canStake(p, stake);
          changed = table(clean(d.name) || "Table privée", pid, !!d.vip, d.rules, stake);
          changed.fillBots = !!d.fillBots && !stake;
          changed.createdBy = pid;
        }
        changed.seats[0] = { id: pid, name: p.name, avatar: p.avatar };
        p.tableId = changed.id;
        if (d.password) {
          check(
            typeof d.password === "string" && d.password.length <= 128,
            "Mot de passe invalide",
          );
          const salt = id();
          changed.password = { salt, hash: hashPassword(d.password, salt) };
        }
        break;
      case "inspectInvite": {
        // Par lien (identifiant + jeton) ou par code court.
        const code = typeof d.code === "string" ? d.code.trim().toUpperCase().replace(/^(\d)/, "VIP-$1") : null;
        const target = code ? Object.values(db.tables).find((x) => x.code === code) : db.tables[d.tableId];
        if (code) check(target, "Code inconnu");
        validateInvite(target, d);
        return { invitation: { ...publicTable(target), tableId: target.id, owner: db.players[target.host]?.name ?? null } };
      }
      case "enter": {
        // L'hôte rouvre une de ses tables privées.
        const target = db.tables[d.tableId];
        check(target && !target.lobby && (target.host === pid || target.createdBy === pid), "Table introuvable");
        if (t && t !== target) leave(p);
        if (!target.seats.some((s) => s?.id === pid)) seatPlayer(target, p);
        target.owner = pid;
        delete target.idleSince;
        changed = target;
        break;
      }
      case "closeTable": {
        const target = db.tables[d.tableId];
        check(target && !target.lobby && (target.host === pid || target.createdBy === pid), "Table introuvable");
        check(!target.seats.some((s) => s && s.id !== pid && !s.bot) && (!target.game || target.game.phase === "finished"), "Des joueurs sont encore à cette table");
        if (p.tableId === target.id) p.tableId = null;
        delete db.tables[target.id];
        break;
      }
      case "join": {
        check(!db.settings.maintenance, "Entrées temporairement fermées");
        if (d.code && !d.tableId) d.tableId = Object.values(db.tables).find((x) => x.code === String(d.code).toUpperCase())?.id;
        const target = db.tables[d.tableId];
        check(target, "Table introuvable");
        check(
          !target.game || target.game.phase === "finished",
          "Partie déjà commencée",
        );
        if (p.tableId && p.tableId !== target.id) {
          const cur = db.tables[p.tableId];
          check(!cur?.game || cur.game.phase === "finished", "Quittez votre table actuelle");
          leave(p);
        }
        check(
          target.seats.some((s) => !s),
          "Table complète",
        );
        canStake(p, target.stake);
        if (target.vip) {
          validateInvite(target, d);
          if (!target.pending.includes(pid)) target.pending.push(pid);
        } else {
          const seat = target.seats.indexOf(null);
          target.seats[seat] = { id: pid, name: p.name, avatar: p.avatar };
          p.tableId = target.id;
          if (!target.owner) target.owner = pid;
          autoStart(target);
          ensureLobby();
        }
        changed = target;
        break;
      }
      case "playLobby": {
        // Mise choisie (200, 500 ou 1 000) : le joueur rejoint la table de ce montant qui a déjà
        // le plus de joueurs, sans invitation ; la partie démarre seule à quatre.
        check(!db.settings.maintenance, "Entrées temporairement fermées");
        const stake = Number(d.stake);
        check(LOBBY.includes(stake), "Mise inconnue");
        canStake(p, stake);
        if (p.tableId) {
          const cur = db.tables[p.tableId];
          check(!cur?.game || cur.game.phase === "finished", "Quittez votre table actuelle");
          if (cur?.lobby && cur.stake === stake) break;
          leave(p);
        }
        ensureLobby();
        const open = Object.values(db.tables)
          .filter((x) => x.lobby && x.stake === stake && (!x.game || x.game.phase === "finished") && x.seats.some((s) => !s))
          .sort((a, b) => humansAt(b) - humansAt(a));
        const target = open[0];
        check(target, "Aucune table disponible");
        if (target.game) target.game = null;
        seatPlayer(target, p);
        autoStart(target);
        ensureLobby();
        changed = target;
        break;
      }
      case "admit":
      case "reject":
        check(t && t.owner === pid, "Créateur uniquement");
        check(!t.game || t.game.phase === "finished", "Partie commencée");
        check(t.pending.includes(d.playerId), "Demande introuvable");
        if (msg.type === "admit") {
          const guest = db.players[d.playerId];
          check(guest && !guest.tableId, "Joueur indisponible");
          canStake(guest, t.stake);
          const seat = Number.isInteger(d.seat)
            ? d.seat
            : t.seats.indexOf(null);
          check(seat >= 0 && seat < 4 && !t.seats[seat], "Place indisponible");
          t.seats[seat] = {
            id: guest.id,
            name: guest.name,
            avatar: guest.avatar,
          };
          guest.tableId = t.id;
        }
        t.pending = t.pending.filter((v) => v !== d.playerId);
        changed = t;
        break;
      case "move":
        check(t && t.owner === pid, "Créateur uniquement");
        check(
          !t.game || t.game.phase === "finished",
          "Places figées après lancement",
        );
        check(
          [d.from, d.to].every((v) => Number.isInteger(v) && v >= 0 && v < 4),
          "Place invalide",
        );
        [t.seats[d.from], t.seats[d.to]] = [t.seats[d.to], t.seats[d.from]];
        changed = t;
        break;
      case "seat":
        check(
          t && (!t.game || t.game.phase === "finished"),
          "Places figées après lancement",
        );
        {
          const from = t.seats.findIndex((s) => s?.id === pid);
          check(
            from >= 0 &&
              Number.isInteger(d.seat) &&
              d.seat >= 0 &&
              d.seat < 4 &&
              !t.seats[d.seat],
            "Place indisponible",
          );
          t.seats[d.seat] = t.seats[from];
          t.seats[from] = null;
          changed = t;
        }
        break;
      case "rematchVote":
        check(t && t.seats.some((s) => s?.id === pid), "Joueur non assis");
        voteRematch(t, pid, d.accept !== false);
        changed = t;
        break;
      case "kick":
      case "bot":
      case "rules":
      case "start":
      case "rematch":
        if (msg.type === "rematch") {
          check(t && t.seats.some((s) => s?.id === pid), "Joueur non assis");
          voteRematch(t, pid, true);
          changed = t;
          break;
        }
        check(t && t.owner === pid, "Créateur uniquement");
        check(
          !t.game || t.game.phase === "finished",
          "Options figées pendant une partie",
        );
        if (msg.type === "rules") {
          t.rules = rules(d.rules);
          if (d.stake !== undefined) {
            const stake = stakeOf(d.stake);
            check(!stake || t.seats.every((s) => !s?.bot), "Retirez les robots pour jouer avec des crédits");
            t.stake = stake;
          }
        }
        if (msg.type === "bot") {
          check(!t.stake, "Les robots complètent uniquement les parties gratuites");
          check(
            Number.isInteger(d.seat) &&
              d.seat >= 0 &&
              d.seat < 4 &&
              !t.seats[d.seat],
            "Place indisponible",
          );
          t.seats[d.seat] = makeBot(d.seat, null, t);
        }
        if (msg.type === "kick") {
          check(
            Number.isInteger(d.seat) &&
              d.seat >= 0 &&
              d.seat < 4 &&
              t.seats[d.seat]?.id !== pid,
            "Place invalide",
          );
          const guest = t.seats[d.seat];
          if (guest && !guest.bot) db.players[guest.id].tableId = null;
          t.seats[d.seat] = null;
        }
        if (msg.type === "start") {
          // Option « Compléter avec des robots » (parties gratuites uniquement).
          if (t.fillBots && !t.stake) for (let i = 0; i < 4; i++) if (!t.seats[i]) t.seats[i] = makeBot(i, null, t);
          start(t);
        }
        if (msg.type === "rematch") voteRematch(t, pid, true);
        changed = t;
        break;
      case "practice":
        check(!db.settings.maintenance, "Création temporairement fermée");
        rules(d.rules);
        if (p.tableId) leave(p);
        changed = table("Entraînement", pid, true, d.rules);
        changed.practice = true;
        changed.seats[0] = { id: pid, name: p.name, avatar: p.avatar };
        for (let i = 1; i < 4; i++) changed.seats[i] = makeBot(i, null, changed);
        p.tableId = changed.id;
        start(changed);
        break;
      case "leave":
        leave(p);
        break;
      case "quick": {
        // Jouer maintenant : une table rapide en attente, sinon une nouvelle.
        // Les places encore libres après le délai sont complétées par des robots.
        check(!db.settings.maintenance, "Entrées temporairement fermées");
        if (t) {
          check(!t.game || t.game.phase === "finished", "Vous jouez déjà une partie");
          leave(p);
        }
        // Avec un compte et assez de crédits : partie à 200 (robots compris, adossés à la Maison).
        const quickStake = p.accountId && economy.available(p) >= toUnits(QUICK_STAKE) ? QUICK_STAKE : 0;
        // Un joueur attend déjà (partie rapide ou table publique de même mise) : on le rejoint.
        let target =
          waitingTables(quickStake)[0] ??
          Object.values(db.tables).find((x) => x.quick && !x.game && x.seats.includes(null) && stakeKey(x) === quickStake);
        if (target?.lobby) {
          seatPlayer(target, p);
          autoStart(target);
          ensureLobby();
          changed = target;
          break;
        }
        if (!target) {
          target = table(quickStake ? `Partie rapide · ${quickStake}` : "Partie rapide", pid, false, {}, quickStake);
          target.quick = true;
          target.houseBots = !!quickStake;
        }
        target.seats[target.seats.indexOf(null)] = { id: pid, name: p.name, avatar: p.avatar };
        p.tableId = target.id;
        target.owner ??= pid;
        target.fillAt ??= Date.now() + fillSeconds * 1000;
        if (target.seats.every(Boolean)) {
          target.fillAt = null;
          start(target);
        }
        changed = target;
        break;
      }
      case "callAnswer": {
        const x = db.tables[String(d.tableId ?? "")];
        if (!d.accept) {
          if (x?.calls) x.calls.declined[pid] = Date.now();
          if (x) changed = x;
          break;
        }
        check(x && waitingForPlayers(x), "Cette partie a déjà commencé");
        check(callable(x, p), "Vous ne pouvez pas rejoindre cette partie");
        if (t && t !== x) leave(p);
        seatPlayer(x, p);
        if (x.seats.every(Boolean)) {
          endCalls(x);
          x.fillAt = null;
          if (x.lobby) autoStart(x);
          else start(x);
        }
        changed = x;
        break;
      }
      case "fillNow":
        // Le joueur ne veut plus attendre : les robots complètent la table tout de suite.
        check(t && (t.quick || t.lobby) && notPlaying(t), "Aucune table en attente");
        t.fillAt = Date.now();
        t.matchUntil = Date.now();
        changed = t;
        break;
      case "action":
        check(t?.game, "Partie introuvable");
        check(d.version === t.game.version, "Action périmée : état actualisé");
        {
          const seat = t.seats.findIndex((s) => s?.id === pid);
          check(seat >= 0, "Joueur non assis");
          act(t.game, seat, d.action);
          finishStats(t);
          changed = t;
        }
        break;
      case "next":
        check(t?.game, "Partie introuvable");
        nextDeal(t.game);
        t.nextAt = null;
        changed = t;
        break;
      case "chat":
        check(t, "Rejoignez une table");
        {
          const text = clean(d.text, 280);
          check(text, "Message vide");
          // Pendant la donne, uniquement des messages prédéfinis : rien ne permet de décrire sa main.
          if (t.game && t.game.phase !== "finished")
            check(REACTIONS.some((r) => r.text === text || r.emoji === text), "Pendant la partie, utilisez les messages prédéfinis");
          t.chat.push({ id: id(), pid, name: p.name, text, at: Date.now() });
          t.chat = t.chat.slice(-60);
        }
        break;
      case "react": {
        check(t, "Rejoignez une table");
        const r = REACTIONS.find((x) => x.id === d.id) ?? (shop.item(String(d.id))?.kind === "emoji" && shop.owns(p, String(d.id)) ? { id: String(d.id) } : null);
        check(r, "Réaction inconnue");
        check(Date.now() - (p.lastReact ?? 0) >= reactionCooldownMs, "Doucement ! Attendez quelques secondes");
        p.lastReact = Date.now();
        t.reactions.push({ id: id(), pid, reaction: r.id, at: Date.now() });
        t.reactions = t.reactions.slice(-12);
        break;
      }
      case "settings":
        if (typeof d.hideStatus === "boolean") p.settings.hideStatus = d.hideStatus;
        if (["all", "friends", "none"].includes(d.invites)) p.settings.invites = d.invites;
        if (typeof d.animations === "boolean") p.settings.animations = d.animations;
        if (typeof d.sounds === "boolean") p.settings.sounds = d.sounds;
        if (typeof d.emojis === "boolean") p.settings.emojis = d.emojis;
        break;
      case "dismissResult":
        delete p.lastResult;
        break;
      case "equip":
        if (shop.item(String(d.id))) {
          const it = shop.item(String(d.id));
          check(shop.owns(p, it.id), "Achetez d’abord cet article");
          check(it.kind === "back" || it.kind === "felt", "Article non équipable");
          progression.prog(p).equipped[it.kind] = it.id;
        } else progression.equip(p, d.id);
        break;
      case "shopBuy": {
        const r = shop.buy(p, String(d.id));
        reply = { bought: r.item.id, balance: r.balance };
        break;
      }
      case "shopFavorites":
        shop.setFavorites(p, d.ids);
        break;
      case "timezone":
        if (validTimeZone(d.timeZone)) p.timeZone = d.timeZone;
        break;
      case "readInbox":
        for (const n of p.inbox ?? []) n.read = true;
        break;
      case "tourRegister": {
        let partner = null;
        if (d.partner) {
          check(p.friends?.[d.partner], "Choisissez un partenaire parmi vos amis");
          partner = d.partner;
        }
        tournaments.register(String(d.id ?? ""), pid, partner);
        break;
      }
      case "tourPartner":
        tournaments.answerPartner(String(d.id ?? ""), pid, d.accept === true);
        break;
      case "tourUnregister":
        tournaments.unregister(String(d.id ?? ""), pid);
        break;
      case "tourConfirm":
        tournaments.confirm(String(d.id ?? ""), pid);
        break;
      case "checkin":
        break;
      case "spin": {
        check(p.accountId, "Compte requis");
        const e = loginBonus(p);
        check(e, "Roue déjà tournée : revenez demain");
        return { segment: e.segment, amount: toCredits(e.amount), balance: toCredits(e.balance), streak: e.streak, mult: e.mult };
      }
      case "wallet":
        return {
          wallet: economy.history(p).map((x) => ({
            id: x.id,
            type: x.type,
            label: x.label,
            amount: toCredits(x.amount),
            balance: toCredits(x.balance),
            at: x.at,
            gameId: x.gameId,
            stake: x.stake ? toCredits(x.stake) : undefined,
            engaged: x.engaged !== undefined ? toCredits(x.engaged) : undefined,
            rubicon: x.rubicon,
            adjusted: x.adjusted,
          })),
        };
      case "search": {
        const q = clean(d.q, 30).toLowerCase();
        check(q.length >= 2, "Tapez au moins deux caractères");
        const found = Object.values(db.players)
          .filter((o) => o.id !== pid && !blockedEither(p, o) && (o.tag?.toLowerCase() === q || o.name.toLowerCase().includes(q)))
          .slice(0, 10)
          .map((o) => ({ id: o.id, name: o.name, avatar: o.avatar, tag: o.tag, friend: !!p.friends[o.id], pending: p.friendOut.includes(o.id) }));
        return { found };
      }
      case "friendRequest": {
        const o = db.players[d.id];
        check(o && o.id !== pid, "Joueur introuvable");
        check(!blockedEither(p, o), "Demande impossible");
        check(!p.friends[o.id], "Déjà amis");
        if (o.friendOut.includes(pid)) {
          // Demande croisée : amitié immédiate.
          o.friendOut = o.friendOut.filter((x) => x !== pid);
          p.friendIn = p.friendIn.filter((x) => x !== o.id);
          p.friends[o.id] = { since: Date.now() };
          o.friends[pid] = { since: Date.now() };
        } else if (!p.friendOut.includes(o.id)) {
          check(p.friendOut.length < 100, "Trop de demandes en attente");
          p.friendOut.push(o.id);
          o.friendIn.push(pid);
        }
        break;
      }
      case "friendAccept":
      case "friendDecline": {
        const o = db.players[d.id];
        check(o && p.friendIn.includes(o.id), "Demande introuvable");
        p.friendIn = p.friendIn.filter((x) => x !== o.id);
        o.friendOut = o.friendOut.filter((x) => x !== pid);
        if (msg.type === "friendAccept") {
          p.friends[o.id] = { since: Date.now() };
          o.friends[pid] = { since: Date.now() };
        }
        break;
      }
      case "friendRemove": {
        const o = db.players[d.id];
        delete p.friends[d.id];
        if (o) delete o.friends[pid];
        break;
      }
      case "favorite":
        check(p.friends[d.id], "Ce joueur n’est pas votre ami");
        p.friends[d.id].favorite = !!d.on;
        break;
      case "invite": {
        // Inviter un ami : aucune réservation, aucun engagement sans son acceptation.
        check(t, "Rejoignez d’abord une table");
        const o = db.players[d.id];
        check(o && o.id !== pid, "Joueur introuvable");
        check(!blockedEither(p, o), "Invitation impossible");
        const policy = o.settings?.invites ?? "friends";
        check(policy !== "none" && (policy === "all" || o.friends[pid]), "Ce joueur n’accepte pas les invitations");
        check(t.seats.some((s) => !s) || (t.game && t.game.phase !== "finished"), "Table complète");
        o.invites = o.invites.filter((i) => i.tableId !== t.id).slice(-19);
        o.invites.push({ id: id(), tableId: t.id, from: pid, fromName: p.name, fromOwner: t.owner === pid, at: Date.now() });
        // Table avec robots : si l'invité ne vient pas à temps, un robot prend la place et la partie démarre.
        if (t.fillBots && !t.stake && !t.game) t.fillAt = Math.max(t.fillAt ?? 0, Date.now() + inviteWaitMs);
        break;
      }
      case "inviteAccept":
      case "inviteDecline": {
        const inv = p.invites.find((i) => i.id === d.id);
        check(inv, "Invitation expirée");
        p.invites = p.invites.filter((i) => i !== inv);
        if (msg.type === "inviteDecline") break;
        const target = db.tables[inv.tableId];
        check(target, "Table fermée");
        check(!target.game || target.game.phase === "finished", "La partie a déjà commencé");
        check(!p.tableId || p.tableId === target.id, "Quittez votre table actuelle");
        canStake(p, target.stake);
        if (target.vip && !inv.fromOwner) {
          if (!target.pending.includes(pid)) target.pending.push(pid);
        } else seatPlayer(target, p);
        changed = target;
        break;
      }
      case "hide":
        if (d.on) p.hidden[d.id] = true;
        else delete p.hidden[d.id];
        break;
      case "block": {
        // Le blocage coupe demandes, invitations et communications, sans toucher à la partie en cours.
        const o = db.players[d.id];
        check(o && o.id !== pid, "Joueur introuvable");
        if (d.on === false) {
          delete p.blocked[o.id];
          delete p.hidden[o.id];
          break;
        }
        p.blocked[o.id] = Date.now();
        p.hidden[o.id] = true;
        delete p.friends[o.id];
        delete o.friends[pid];
        p.friendIn = p.friendIn.filter((x) => x !== o.id);
        p.friendOut = p.friendOut.filter((x) => x !== o.id);
        o.friendIn = o.friendIn.filter((x) => x !== pid);
        o.friendOut = o.friendOut.filter((x) => x !== pid);
        p.invites = p.invites.filter((i) => i.from !== o.id);
        break;
      }
      case "report":
        if (d.target) {
          const o = db.players[d.target] ?? Object.values(db.tables).flatMap((x) => x.seats).find((s) => s?.id === d.target);
          check(o, "Joueur introuvable");
          check(REPORT_REASONS[d.category], "Motif requis");
          check(
            db.reports.filter((r) => r.by === pid && Date.now() - r.at < 3600000).length < 10,
            "Trop de signalements",
          );
          const tt = db.tables[p.tableId];
          // Contexte joint automatiquement : partie, donne, derniers messages et réactions du joueur.
          db.reports.push({
            id: id(),
            by: pid,
            byName: p.name,
            target: d.target,
            targetName: o.name,
            category: d.category,
            reason: REPORT_REASONS[d.category],
            comment: clean(d.comment, 500),
            table: tt?.id,
            gameId: tt?.gameId ?? null,
            deal: tt?.game?.deal ?? null,
            context: {
              chat: (tt?.chat ?? []).filter((m) => m.pid === d.target).slice(-10),
              reactions: (tt?.reactions ?? []).filter((r) => r.pid === d.target).slice(-10),
              ledger: (db.ledger ?? []).filter((x) => x.pid === d.target).slice(-10),
            },
            at: Date.now(),
            resolved: false,
          });
          break;
        }
        check(clean(d.reason, 500), "Motif requis");
        check(
          db.reports.filter((r) => r.by === pid && Date.now() - r.at < 3600000)
            .length < 10,
          "Trop de signalements",
        );
        db.reports.push({
          id: id(),
          by: pid,
          table: t?.id,
          reason: clean(d.reason, 500),
          at: Date.now(),
          resolved: false,
        });
        break;
      default:
        throw Error("Commande inconnue");
    }
    if (changed) update(changed);
    p.seen.push(msg.id);
    p.seen = p.seen.slice(-200);
    broadcast();
    return reply ?? { ok: true };
  }
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
    ".txt": "text/plain; charset=utf-8",
    ".woff2": "font/woff2",
  };
  const cookieToken = (req) =>
    /\bbelote_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? "")?.[1];
  function getPlayer(req) {
    const token = cookieToken(req);
    if (!token) return null;
    return (
      accounts.resolve(token) ??
      Object.values(db.players).find((p) => p.token && p.token === token)
    );
  }
  const accounts = createAccounts({
    db,
    mail: createMailer(db),
    baseUrl,
    newPlayer,
    retirePlayer,
    // Crédits de bienvenue, une seule fois par adresse.
    onAccount: (p, acc) => economy.signupBonus(p, acc),
  });
  const secure = (req) =>
    req.socket.encrypted || process.env.BELOTE_SECURE_COOKIE === "true" ? "; Secure" : "";
  function setSession(req, res, p) {
    res.setHeader(
      "Set-Cookie",
      `belote_session=${accounts.session(p)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure(req)}`,
    );
  }
  const sameOrigin = (req) =>
    !req.headers.origin ||
    req.headers.origin === `http://${req.headers.host}` ||
    req.headers.origin === `https://${req.headers.host}`;
  async function readBody(req, max) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > max) throw Object.assign(Error("Contenu trop volumineux"), { status: 413 });
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  const authRate = new Map();
  function authLimit(req) {
    const ip = req.socket.remoteAddress ?? "?";
    const now = Date.now();
    const r = authRate.get(ip);
    if (!r || now - r.at > 60_000) authRate.set(ip, { at: now, n: 1 });
    else if (++r.n > 20) throw Object.assign(Error("Trop de tentatives, réessayez dans une minute."), { status: 429 });
  }
  // Crédit d'un achat vérifié, une seule fois par transaction de la plateforme.
  function creditPurchase(p, purchase) {
    check(p, "Joueur introuvable");
    const pack = economy.config.packs.find((x) => x.id === purchase.packId);
    check(pack, "Pack inconnu");
    const e = economy.post(p, `purchase:${purchase.provider}:${purchase.transactionId}`, "purchase", toUnits(pack.credits), {
      label: `Pack ${pack.credits} crédits`,
      provider: purchase.provider,
      transactionId: purchase.transactionId,
    });
    persist();
    return e;
  }
  function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }
  // Les domaines Apple / Google ne sont autorisés que si la connexion correspondante est configurée.
  const ext = { script: [], frame: [], connect: [] };
  if (process.env.GOOGLE_CLIENT_ID) {
    ext.script.push("https://accounts.google.com/gsi/client");
    ext.frame.push("https://accounts.google.com");
    ext.connect.push("https://accounts.google.com");
  }
  if (process.env.APPLE_CLIENT_ID) {
    ext.script.push("https://appleid.cdn-apple.com");
    ext.frame.push("https://appleid.apple.com");
    ext.connect.push("https://appleid.apple.com");
  }
  const csp = [
    "default-src 'self'",
    `connect-src 'self' ${ext.connect.join(" ")}`.trim(),
    "style-src 'self'",
    `script-src 'self' ${ext.script.join(" ")}`.trim(),
    "img-src 'self' data: blob:",
    "font-src 'self'",
    ext.frame.length ? `frame-src ${ext.frame.join(" ")}` : "frame-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      csp,
    );
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/health") {
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          ok: true,
          version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
          cards: "svg-cards",
          storage: ephemeral ? "temporaire (aucun volume)" : "persistant",
          dataSince: new Date(db.createdAt).toISOString(),
        }),
      );
    }
    if (url.pathname === "/api/session" && req.method === "POST") {
      if (!sameOrigin(req)) {
        res.writeHead(403);
        return res.end();
      }
      let p = getPlayer(req);
      if (p?.banned) {
        res.writeHead(403);
        return res.end("Profil suspendu");
      }
      if (!p) {
        p = newPlayer();
        setSession(req, res, p);
        persist();
      }
      return json(res, 200, playerView(p));
    }
    if (url.pathname === "/api/auth/config") {
      return json(res, 200, {
        google: process.env.GOOGLE_CLIENT_ID?.split(",")[0] || null,
        apple: process.env.APPLE_CLIENT_ID?.split(",")[0] || null,
        mail: !!(process.env.RESEND_API_KEY && process.env.BELOTE_MAIL_FROM),
      });
    }
    if (url.pathname === "/api/auth/verify" && req.method === "GET") {
      let ok = true;
      try {
        accounts.verify(url.searchParams.get("token"));
        broadcast();
      } catch {
        ok = false;
      }
      res.writeHead(302, { Location: ok ? "/#verified" : "/#verify-failed" });
      return res.end();
    }
    if (url.pathname.startsWith("/api/auth/") && req.method === "POST") {
      try {
        if (!sameOrigin(req)) throw Object.assign(Error("Origine refusée"), { status: 403 });
        authLimit(req);
        const d = JSON.parse((await readBody(req, 8192)).toString() || "{}");
        const p = getPlayer(req);
        const action = url.pathname.slice("/api/auth/".length);
        let next = null;
        if (action === "register") {
          // Pseudo choisi à l'inscription : unique, vérifié avant de créer le compte.
          if (d.name !== undefined) {
            const name = clean(d.name, 24);
            check(name.length >= 2, "Pseudo trop court");
            check(!nameTaken(name, p?.id), "Ce pseudo est déjà pris, choisissez-en un autre");
          }
          next = await accounts.register(p ?? newPlayer(), d, req);
        }
        else if (action === "login") next = accounts.login(p, d);
        else if (action === "oidc") next = await accounts.oidc(p ?? newPlayer(), d);
        else if (action === "forgot") await accounts.forgot(d, req);
        else if (action === "reset") next = accounts.reset(d);
        else if (action === "resend") await accounts.resend(p, req);
        else if (action === "password") accounts.changePassword(p, d);
        else if (action === "logout" || action === "delete") {
          check(p, "Session absente");
          if (action === "delete") accounts.remove(p, d);
          else {
            check(!p.tableId || !db.tables[p.tableId]?.game || db.tables[p.tableId].game.phase === "finished", "Quittez d’abord la partie en cours");
            if (p.tableId) leave(p);
            accounts.logout(cookieToken(req));
          }
          next = newPlayer();
        } else throw Object.assign(Error("Action inconnue"), { status: 404 });
        if (next) {
          if (next !== p) {
            for (const ws of connections.get(p?.id) ?? []) ws.close(4001, "Session changée");
          }
          setSession(req, res, next);
        }
        persist();
        broadcast();
        return json(res, 200, next ? playerView(next) : { ok: true });
      } catch (e) {
        return json(res, e.status ?? 400, { error: e.message });
      }
    }
    if (url.pathname === "/api/avatar" && req.method === "POST") {
      try {
        if (!sameOrigin(req)) throw Object.assign(Error("Origine refusée"), { status: 403 });
        const p = getPlayer(req);
        check(p && !p.banned, "Session absente");
        consume(p.id);
        const img = await readBody(req, 400_000);
        // Uniquement du JPEG produit par le recadrage du navigateur.
        check(img.length > 100 && img[0] === 0xff && img[1] === 0xd8 && img[2] === 0xff, "Image JPEG attendue");
        const name = randomBytes(16).toString("hex");
        writeFileSync(path.join(photoDir, name + ".jpg"), img, { mode: 0o600 });
        if (p.photo) {
          try {
            unlinkSync(path.join(photoDir, p.photo.slice(2) + ".jpg"));
          } catch {}
        }
        p.photo = "u:" + name;
        p.avatar = p.photo;
        const t = db.tables[p.tableId];
        const seat = t?.seats.find((s) => s?.id === p.id);
        if (seat) seat.avatar = p.avatar;
        broadcast();
        return json(res, 200, playerView(p));
      } catch (e) {
        return json(res, e.status ?? 400, { error: e.message });
      }
    }
    // Classement des joueurs (comptes uniquement) : victoires, parties, ratio.
    if (url.pathname === "/api/classement") {
      const me = getPlayer(req);
      // Tournois gagnés : les joueurs de l'équipe championne.
      const cups = {};
      for (const tour of Object.values(db.tournaments ?? {}))
        if (tour.status === "finished" && tour.champion)
          for (const pid of tour.teamsList?.find((x) => x.id === tour.champion)?.pids ?? []) cups[pid] = (cups[pid] ?? 0) + 1;
      const rows = Object.values(db.players)
        .filter((p) => p.accountId && !p.banned && p.stats?.games > 0)
        .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, games: p.stats.games, wins: p.stats.wins, ratio: Math.round((p.stats.wins / p.stats.games) * 1000) / 10, cups: cups[p.id] ?? 0, me: p.id === me?.id }));
      return json(res, 200, { players: rows, minGamesForRatio: 10 });
    }
    if (url.pathname === "/api/push/config") {
      return json(res, 200, { vapidPublicKey: pushCfg.vapidPrivate ? pushCfg.vapidPublic : null, native: !!pushCfg.fcm });
    }
    if ((url.pathname === "/api/push/subscribe" || url.pathname === "/api/push/unsubscribe") && req.method === "POST") {
      try {
        if (!sameOrigin(req)) throw Object.assign(Error("Origine refusée"), { status: 403 });
        const p = getPlayer(req);
        check(p && !p.banned, "Session absente");
        consume(p.id);
        const d = JSON.parse((await readBody(req, 4096)).toString() || "{}");
        p.push ??= { web: [], fcm: [] };
        const add = url.pathname.endsWith("/subscribe");
        if (d.type === "web") {
          const sub = d.subscription ?? {};
          check(typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1024, "Abonnement invalide");
          p.push.web = p.push.web.filter((x) => x.endpoint !== sub.endpoint);
          if (add) {
            check(typeof sub.keys?.p256dh === "string" && typeof sub.keys?.auth === "string" && sub.keys.p256dh.length < 200 && sub.keys.auth.length < 100, "Abonnement invalide");
            p.push.web = [...p.push.web, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }].slice(-5);
          }
        } else if (d.type === "fcm") {
          check(typeof d.token === "string" && d.token.length > 10 && d.token.length < 4096, "Jeton invalide");
          p.push.fcm = p.push.fcm.filter((x) => x.token !== d.token);
          if (add) p.push.fcm = [...p.push.fcm, { token: d.token, platform: d.platform === "ios" ? "ios" : "android" }].slice(-5);
        } else throw Error("Type inconnu");
        persist();
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, e.status ?? 400, { error: e.message });
      }
    }
    if (url.pathname === "/api/shop/config") {
      const c = economy.config;
      return json(res, 200, {
        packs: c.packs.map(({ id, credits, price, bonus }) => ({ id, credits, price, bonus })),
        purchases: c.purchases,
        stripe: c.stripe,
        apple: c.apple,
        google: c.google,
        test: c.testShop,
      });
    }
    if (url.pathname.startsWith("/api/shop/") && req.method === "POST") {
      const cfg = economy.config;
      try {
        const action = url.pathname.slice("/api/shop/".length);
        const raw = (await readBody(req, 65536)).toString();
        if (action === "stripe-webhook") {
          // Notification signée par Stripe : peut arriver plusieurs fois, créditée une seule fois.
          if (!cfg.stripe) throw Object.assign(Error("Stripe non configuré"), { status: 501 });
          const ev = stripeEvent(raw, req.headers["stripe-signature"], env);
          if (ev) creditPurchase(db.players[ev.playerId], ev);
          return json(res, 200, { received: true });
        }
        if (!sameOrigin(req)) throw Object.assign(Error("Origine refusée"), { status: 403 });
        const p = getPlayer(req);
        check(p?.accountId, "Créez un compte pour acheter des crédits");
        check(cfg.purchases || (action === "test" && cfg.testShop), "La boutique est fermée pour le moment");
        const d = JSON.parse(raw || "{}");
        let result;
        if (action === "checkout") {
          check(cfg.stripe, "Paiement web non configuré");
          const pack = cfg.packs.find((x) => x.id === d.pack);
          check(pack, "Pack inconnu");
          return json(res, 200, { url: await stripeCheckout({ env, pack, player: p, origin: baseUrl(req) }) });
        } else if (action === "apple") {
          check(cfg.apple, "Achats iOS non configurés");
          result = creditPurchase(p, verifyAppleTransaction(d.signedTransaction, env));
        } else if (action === "google") {
          check(cfg.google, "Achats Android non configurés");
          result = creditPurchase(p, await verifyGooglePurchase(d, env));
        } else if (action === "test") {
          // Paiement fictif réservé au développement : refusé dès que l'environnement est en production.
          check(cfg.testShop, "Indisponible");
          result = creditPurchase(p, { provider: "test", transactionId: clean(d.transactionId, 80) || id(), packId: d.pack });
        } else throw Object.assign(Error("Action inconnue"), { status: 404 });
        broadcast();
        return json(res, 200, { ok: true, credited: !!result, wallet: economy.view(p) });
      } catch (e) {
        return json(res, e.status ?? 400, { error: e.message });
      }
    }
    const photo = /^\/u\/([0-9a-f]{32})\.jpg$/.exec(url.pathname);
    if (photo && existsSync(path.join(photoDir, photo[1] + ".jpg"))) {
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" });
      return res.end(readFileSync(path.join(photoDir, photo[1] + ".jpg")));
    }
    if (url.pathname === "/api/admin") {
      const supplied = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (
        !adminKey ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(adminKey) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(adminKey))
      ) {
        res.writeHead(403);
        return res.end("Administration non autorisée");
      }
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 16384) {
            res.writeHead(413);
            return res.end();
          }
        }
        try {
          const d = JSON.parse(body);
          if (d.type === "reviewAlert") {
            const a = db.alerts.find((x) => x.id === d.id);
            check(a, "Alerte introuvable");
            a.reviewed = Date.now();
            a.note = clean(d.note, 500);
          } else if (d.type === "cancelGame") {
            const t = db.tables[d.id];
            check(t?.game && t.game.phase !== "finished", "Aucune partie en cours");
            cancelGame(t, "Partie annulée (incident technique)");
          } else if (d.type === "grant") {
            const p = db.players[d.player];
            check(p, "Joueur introuvable");
            progression.grant(p, d.item);
          } else if (d.type === "resolve") {
            const r = db.reports.find((r) => r.id === d.id);
            check(r, "Signalement introuvable");
            r.resolved = true;
          } else if (d.type === "tourCreate") {
            tournaments.create(d.data ?? {});
          } else if (d.type === "tourUpdate") {
            tournaments.update(String(d.id), d.data ?? {});
          } else if (d.type === "tourPublish") {
            tournaments.publish(String(d.id));
          } else if (d.type === "tourPostpone") {
            tournaments.postpone(String(d.id), d.start);
          } else if (d.type === "tourCancel") {
            tournaments.cancel(String(d.id), clean(d.reason || "Annulé par l’organisateur", 200));
          } else if (d.type === "tourDuplicate") {
            tournaments.duplicate(String(d.id));
          } else if (d.type === "loginBonus") {
            check(Number.isInteger(d.amount) && d.amount >= 0 && d.amount <= 100000, "Montant invalide");
            db.settings.loginBonus = d.amount;
          } else if (d.type === "maintenance") {
            check(typeof d.enabled === "boolean", "Valeur invalide");
            db.settings.maintenance = d.enabled;
          } else if (d.type === "suspend") {
            const p = db.players[d.id];
            check(p, "Joueur introuvable");
            check(typeof d.enabled === "boolean", "Valeur invalide");
            p.banned = d.enabled;
            if (p.banned)
              for (const ws of connections.get(p.id) ?? [])
                ws.close(1008, "Profil suspendu");
          } else if (d.type === "playerCredit") {
            const p = db.players[d.id];
            check(p, "Joueur introuvable");
            const amount = Number(d.amount);
            check(Number.isFinite(amount) && amount !== 0 && Math.abs(amount) <= 1_000_000 && Number.isInteger(amount * 2), "Montant invalide");
            const units = toUnits(amount);
            check(units > 0 || economy.available(p) + units >= 0, "Solde disponible insuffisant");
            economy.post(p, `admin:${randomBytes(9).toString("base64url")}`, "admin", units, { label: clean(d.reason || (units > 0 ? "Crédit manuel" : "Débit manuel"), 120) });
            deliver(p.id, { title: units > 0 ? "Crédits ajoutés" : "Crédits retirés", body: `${Math.abs(amount)} crédits ${units > 0 ? "ajoutés à" : "retirés de"} votre compte par l’administration.`, kind: "admin" });
          } else if (d.type === "playerUpdate") {
            const p = db.players[d.id];
            check(p, "Joueur introuvable");
            if (d.name !== undefined) {
              const name = clean(d.name, 24);
              check(name.length >= 2, "Pseudo trop court");
              check(!nameTaken(name, p.id), "Ce pseudo est déjà pris");
              p.name = name;
            }
            if (d.avatar !== undefined) p.avatar = clean(d.avatar, 8) || p.avatar;
            const acc = p.accountId && db.accounts[p.accountId];
            if (acc && d.email !== undefined) {
              const email = normalizeEmail(d.email);
              check(!Object.values(db.accounts).some((a) => a !== acc && a.email === email), "Adresse e-mail déjà utilisée");
              acc.email = email;
            }
            if (acc && typeof d.verified === "boolean") acc.verified = d.verified;
          } else if (d.type === "playerDelete") {
            const p = db.players[d.id];
            check(p, "Joueur introuvable");
            const t = db.tables[p.tableId];
            check(!(t?.game && t.game.phase !== "finished" && t.money && !t.money.settled), "Joueur engagé dans une partie à crédits en cours");
            if (p.accountId) {
              const accId = p.accountId;
              delete db.accounts[accId];
              for (const [k, v] of Object.entries(db.tokens ?? {})) if (v.accountId === accId) delete db.tokens[k];
            }
            for (const [k, v] of Object.entries(db.sessions ?? {})) if (v.playerId === p.id) delete db.sessions[k];
            retirePlayer(p);
          } else if (d.type === "shopItem") {
            shop.update(String(d.id), d);
          } else if (d.type === "deleteTable") {
            const t = db.tables[d.id];
            check(t, "Table introuvable");
            check(
              !t.game || t.game.phase === "finished",
              "Impossible de supprimer une partie en cours",
            );
            for (const s of t.seats)
              if (s && !s.bot) db.players[s.id].tableId = null;
            delete db.tables[t.id];
            ensureLobby();
          } else throw Error("Commande inconnue");
          broadcast();
        } catch (e) {
          res.writeHead(400);
          return res.end(e.message);
        }
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      const detailId = url.searchParams.get("player");
      if (detailId && req.method === "GET") {
        const p = db.players[detailId];
        if (!p) {
          res.writeHead(404);
          return res.end("Joueur introuvable");
        }
        return res.end(
          JSON.stringify({
            ...playerView(p),
            tableId: p.tableId ?? null,
            createdAt: p.createdAt ?? null,
            online: connections.has(p.id),
            ledger: economy.history(p, 200).map((e) => ({ ...e, amount: toCredits(e.amount), balance: toCredits(e.balance) })),
          }),
        );
      }
      return res.end(
        JSON.stringify({
          players: Object.values(db.players).map((p) => ({ ...playerView(p), online: connections.has(p.id) })),
          tables: Object.values(db.tables).map((t) => ({ ...publicTable(t), engaged: !!(t.money && !t.money.settled) })),
          reports: db.reports,
          alerts: db.alerts.map((a) => ({ ...a, names: a.players.map((x) => db.players[x]?.name ?? x) })),
          settings: db.settings,
          storage: { ephemeral, since: db.createdAt },
          tournaments: tournaments.adminList(),
          rewards: TOURNAMENT_REWARDS,
          shop: shop.catalog(),
          push: { web: !!(pushCfg.vapidPublic && pushCfg.vapidPrivate), native: !!pushCfg.fcm },
          economy: {
            loginBonus: economy.config.loginBonus,
            purchases: economy.config.purchases,
            stripe: economy.config.stripe,
            apple: economy.config.apple,
            google: economy.config.google,
            reserved: toCredits(Object.values(db.players).reduce((a, p) => a + (p.wallet?.reserved ?? 0), 0)),
            circulating: toCredits(Object.values(db.players).reduce((a, p) => a + (p.wallet?.balance ?? 0), 0)),
          },
        }),
      );
    }
    const rel = url.pathname === "/" || url.pathname === "/admin" ? "index.html" : url.pathname.slice(1);
    const allowed = [
      "index.html",
      "app.js",
      "cards.js",
      "tips.js",
      "style.css",
      "cards-LICENSE.txt",
      "sw.js",
      "manifest.webmanifest",
    ];
    const cardFile =
      /^cards\/(?:[789]|10|[JQKA])[SHCD]\.svg$/.test(rel) ||
      (/^avatars\/[a-z-]+\.webp$/.test(rel) && AVATARS.includes(rel.slice(8, -5))) ||
      (/^avatars\/[a-z-]+\.svg$/.test(rel) && BOT_AVATARS.includes(rel.slice(8, -4))) ||
      /^fonts\/[a-z0-9-]+\.woff2$/.test(rel) && existsSync(path.join(root, "public", rel)) ||
      /^decor\/[a-z0-9-]+\.(?:svg|webp)$/.test(rel) ||
      /^shop\/(?:avatars|emoji|backs|felts|frames)\/[a-z0-9-]+\.webp$/.test(rel) ||
      /^icons\/icon-(?:192|512|maskable)\.png$/.test(rel);
    if ((!allowed.includes(rel) && !cardFile) || !existsSync(path.join(root, "public", rel))) {
      res.writeHead(404);
      return res.end("Introuvable");
    }
    res.setHeader("Content-Type", mime[path.extname(rel)]);
    res.setHeader(
      "Cache-Control",
      cardFile ? "public, max-age=86400" : "no-cache",
    );
    res.end(readFileSync(path.join(root, "public", rel)));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on("upgrade", (req, socket, head) => {
    const p = getPlayer(req),
      origin = req.headers.origin;
    if (
      req.url !== "/ws" ||
      !p ||
      p.banned ||
      (origin &&
        origin !== `http://${req.headers.host}` &&
        origin !== `https://${req.headers.host}`)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, p));
  });
  wss.on("connection", (ws, p) => {
    let set = connections.get(p.id);
    if (!set) {
      set = new Set();
      connections.set(p.id, set);
    }
    set.add(ws);
    const t = db.tables[p.tableId];
    const seat = t?.seats.find((s) => s?.id === p.id);
    if (seat) delete seat.disconnectedAt;
    broadcast();
    ws.alive = true;
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
        const result = command(p.id, msg);
        send(ws, { type: "ack", id: msg.id, ...result });
      } catch (e) {
        send(ws, { type: "error", id: msg?.id, message: e.message, ...(e.code ? { code: e.code, balance: e.balance, missing: e.missing, required: e.required, price: e.price } : {}) });
        broadcast();
      }
    });
    ws.on("close", () => {
      set.delete(ws);
      if (!set.size) {
        connections.delete(p.id);
        const t = db.tables[p.tableId],
          s = t?.seats.find((s) => s?.id === p.id);
        if (s) s.disconnectedAt = Date.now();
        broadcast();
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 15000);
  heartbeat.unref();
  let lastTourTick = 0,
    lastTourSig = "";
  const tourSignature = () => JSON.stringify(Object.values(db.tournaments).map((x) => [tournaments.stage(x), x.formedAt, x.start, x.rounds?.flat().map((m) => m.status), Object.keys(x.sent).length]));
  const timer = setInterval(() => {
    let dirty = false;
    const now = Date.now();
    if (now - lastTourTick >= 1000) {
      // Programmation des tournois : ouverture, rappels, présence, départ… sans administrateur.
      lastTourTick = now;
      if (ensureLobby()) dirty = true;
      try {
        tournaments.tick();
      } catch (e) {
        console.error("Tournois :", e.message);
      }
      // Les étapes dépendent aussi de l'heure : on compare avec le passage précédent.
      const sig = tourSignature();
      if (sig !== lastTourSig) dirty = true;
      lastTourSig = sig;
    }
    for (const t of Object.values(db.tables)) {
      if (waitingForPlayers(t)) {
        if (callPlayers(t, now)) dirty = true;
      } else if (t.calls) endCalls(t);
      if (t.idleSince && now - t.idleSince > 14 * 86400_000 && !t.seats.some(Boolean)) {
        delete db.tables[t.id];
        continue;
      }
      if (expireQuickRematch(t, now)) {
        dirty = true;
        continue;
      }
      // Départ annoncé : les joueurs ont été montrés à leur place un instant, la partie commence.
      if (notPlaying(t) && t.startAt && now >= t.startAt) {
        t.startAt = null;
        if (t.seats.every(Boolean)) start(t);
        else {
          t.fillAt = now; // quelqu'un est parti entre-temps : on complète de nouveau
          update(t);
        }
        dirty = true;
        continue;
      }
      if ((t.quick || t.lobby || (t.fillBots && !t.stake)) && (!t.game || t.game.phase === "finished") && t.fillAt && now >= t.fillAt) {
        if (t.lobby && t.stake) t.houseBots = true; // tables enregistrées avant les robots de la Maison
        if (t.lobby && !t.seats.some((x) => x && !x.bot)) {
          t.fillAt = null; // plus personne : on n'installe pas de robots dans le vide
          continue;
        }
        const before = (t.quick || t.lobby) && (!t.game || !t.rematch); // avant une nouvelle partie (pas pendant la revanche)
        if (before) gatherHumans(t); // joueurs réels d'abord, robots ensuite
        if (before) {
          // Avant la partie : les robots s'installent un par un dans les places libres, visibles par tous,
          // puis la partie démarre après un court instant.
          const i = t.seats.indexOf(null);
          if (i >= 0) t.seats[i] = makeBot(i, null, t);
          if (t.seats.includes(null)) t.fillAt = now + botStepMs;
          else {
            t.fillAt = null;
            t.startAt = now + startDelayMs;
          }
          update(t);
          dirty = true;
          continue;
        }
        for (let i = 0; i < 4; i++) if (!t.seats[i]) t.seats[i] = makeBot(i, null, t);
        t.fillAt = null;
        if (!t.game) start(t);
        else update(t);
        dirty = true;
        continue;
      }
      if (!t.game) {
        for (let i = 0; i < 4; i++) {
          const s = t.seats[i];
          if (
            s &&
            !s.bot &&
            s.disconnectedAt &&
            now - s.disconnectedAt > t.rules.reconnectSeconds * 1000
          ) {
            t.seats[i] = null;
            db.players[s.id].tableId = null;
            if (t.owner === s.id)
              t.owner = t.seats.find((s) => s && !s.bot)?.id ?? null;
            t.revision++;
            dirty = true;
          }
        }
        continue;
      }
      const g = t.game;
      // Donne suivante automatique après quelques secondes d'affichage du résultat.
      if (g.phase === "summary") {
        t.nextAt ??= now + summaryMs;
        if (now >= t.nextAt) {
          t.nextAt = null;
          nextDeal(g);
          update(t);
          dirty = true;
        }
        continue;
      }
      if (t.tournament && g.phase !== "finished") {
        // Absence prolongée en tournoi : forfait de l'équipe (la première partie absente perd).
        const gone = t.seats
          .map((s, seat) => ({ s, seat }))
          .filter(({ s }) => s && !connections.has(s.id) && s.disconnectedAt && now - s.disconnectedAt >= t.tournament.forfeitSeconds * 1000)
          .sort((x, y) => x.s.disconnectedAt - y.s.disconnectedAt);
        if (gone.length) {
          tournaments.forfeit(t.id, gone[0].seat % 2, `Absence prolongée de ${gone[0].s.name}`);
          dirty = true;
          continue;
        }
      }
      if (expireCounter(g, now)) {
        update(t);
        dirty = true;
      }
      if (["bidding", "playing"].includes(g.phase)) {
        const s = t.seats[g.turn];
        const absent =
          !t.tournament &&
          s &&
          !s.bot &&
          !connections.has(s.id) &&
          s.disconnectedAt &&
          now - s.disconnectedAt >= t.rules.reconnectSeconds * 1000;
        // Dernière carte de la donne : jouée toute seule, chacun à son tour.
        const lastCard = g.phase === "playing" && g.hands[g.turn]?.length === 1;
        if (
          ((s?.bot || absent || lastCard) && now >= Math.max(t.botAt, lastCard ? t.lastCardAt ?? 0 : 0)) ||
          (t.deadline && now >= t.deadline)
        ) {
          const a = lastCard
            ? { type: "play", card: g.hands[g.turn][0] }
            : s?.bot || absent
              ? botAction(view(g, g.turn))
              : g.phase === "bidding"
                ? { type: "pass" }
                : // Temps écoulé : la carte la plus forte autorisée est jouée.
                  { type: "play", card: strongestCard(view(g, g.turn).legal, g.contract.suit) };
          try {
            act(g, g.turn, a);
            finishStats(t);
            update(t);
            dirty = true;
          } catch (e) {
            console.error("Automatisme impossible:", e.message);
          }
        }
      }
    }
    if (dirty) broadcast();
  }, tickMs);
  timer.unref();
  persist();
  return {
    server,
    db,
    close: () =>
      new Promise((resolve) => {
        closing = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        persist();
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => server.close(resolve));
      }),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, "0.0.0.0", () =>
    console.log(`Belote prête, port ${port}`),
  );
  for (const sig of ["SIGTERM", "SIGINT"])
    process.on(sig, () => app.close().then(() => process.exit(0)));
}
